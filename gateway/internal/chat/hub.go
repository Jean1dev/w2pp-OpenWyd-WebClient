// Package chat is the page's global text chat (ADR 018): one room per gateway,
// kept only in memory while messages are delivered. It is unrelated to the
// game protocol and never touches the relayed CPSock stream.
//
// One goroutine (Hub.Run) owns the room; connections talk to it through
// channels. The nick always comes from the gateway session, never from the
// browser. Message text and nicks are never logged.
package chat

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/coder/websocket"
)

const (
	// MaxRunes bounds one message; the page uses the same maxlength.
	MaxRunes = 200
	// readLimit bounds one browser frame: {"t":"say","text":...} with 200
	// runes of up to 4 bytes, JSON escapes included, fits in 1 KiB.
	readLimit = 1024
	// sendQueue is the per-connection backlog; a client that falls this far
	// behind is dropped instead of slowing the room down.
	sendQueue = 32
	// directQueue holds replies to this connection only (hello, errors).
	directQueue = 4
	// Token bucket: bursts of rateBurst, refilled at one message per rateEvery.
	rateBurst = 5
	rateEvery = 2 * time.Second

	pingEvery    = 30 * time.Second
	writeTimeout = 10 * time.Second
)

// Hub is one chat room.
type Hub struct {
	log   *slog.Logger
	now   func() time.Time
	join  chan *client
	leave chan *client
	say   chan []byte
	done  chan struct{}
	ids   atomic.Uint64
	ping  time.Duration
}

// NewHub creates a room; call Run to serve it.
func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		log:   log,
		now:   time.Now,
		join:  make(chan *client),
		leave: make(chan *client),
		say:   make(chan []byte, 64),
		done:  make(chan struct{}),
		ping:  pingEvery,
	}
}

type client struct {
	// send is owned by the hub, which closes it; direct is owned by Serve.
	send   chan []byte
	direct chan []byte
	// why is set by the hub before it closes send.
	why atomic.Pointer[closeReason]
}

type closeReason struct {
	code websocket.StatusCode
	text string
}

var (
	reasonSlow     = &closeReason{websocket.StatusPolicyViolation, "slow client"}
	reasonShutdown = &closeReason{websocket.StatusGoingAway, "shutdown"}
)

// Wire format: JSON text frames.
type (
	helloFrame struct {
		T       string `json:"t"`
		Nick    string `json:"nick"`
		CanSend bool   `json:"canSend"`
	}
	msgFrame struct {
		T    string `json:"t"`
		Nick string `json:"nick"`
		Text string `json:"text"`
		TS   int64  `json:"ts"`
	}
	onlineFrame struct {
		T string `json:"t"`
		N int    `json:"n"`
	}
	errorFrame struct {
		T    string `json:"t"`
		Code string `json:"code"`
	}
	inFrame struct {
		T    string `json:"t"`
		Text string `json:"text"`
	}
)

func encode(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// Run serves the room until ctx ends, then closes every connection.
func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	clients := map[*client]struct{}{}
	drop := func(c *client, why *closeReason) {
		c.why.Store(why)
		close(c.send)
		delete(clients, c)
	}
	// deliver queues b for everyone; a full queue drops that client, and the
	// new head count is announced until no one else falls behind.
	var deliver func(b []byte)
	deliver = func(b []byte) {
		dropped := false
		for c := range clients {
			select {
			case c.send <- b:
			default:
				drop(c, reasonSlow)
				dropped = true
			}
		}
		if dropped {
			deliver(encode(onlineFrame{"online", len(clients)}))
		}
	}
	for {
		select {
		case c := <-h.join:
			clients[c] = struct{}{}
			deliver(encode(onlineFrame{"online", len(clients)}))
		case c := <-h.leave:
			if _, ok := clients[c]; ok {
				delete(clients, c)
				close(c.send)
				deliver(encode(onlineFrame{"online", len(clients)}))
			}
		case b := <-h.say:
			deliver(b)
		case <-ctx.Done():
			for c := range clients {
				drop(c, reasonShutdown)
			}
			return
		}
	}
}

// Serve runs one browser connection until it ends and returns why it ended.
// An empty nick makes the connection read-only.
func (h *Hub) Serve(ctx context.Context, ws *websocket.Conn, nick string) (sent int, reason string) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ws.SetReadLimit(readLimit)
	c := &client{send: make(chan []byte, sendQueue), direct: make(chan []byte, directQueue)}
	// The hello goes first: the writer drains direct before anything else.
	c.direct <- encode(helloFrame{T: "hello", Nick: nick, CanSend: nick != ""})
	select {
	case h.join <- c:
	case <-h.done:
		ws.Close(websocket.StatusGoingAway, "shutdown")
		return 0, "shutdown"
	}

	writerDone := make(chan string, 1)
	go func() { writerDone <- h.write(ctx, ws, c) }()

	tokens, last := float64(rateBurst), h.now()
	reply := func(code string) {
		// Best effort: a client too slow to read its own error replies loses them.
		select {
		case c.direct <- encode(errorFrame{"error", code}):
		default:
		}
	}
	reason = "browser closed"
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			if s := websocket.CloseStatus(err); s == -1 && ctx.Err() == nil {
				reason = "browser error"
			}
			break
		}
		if typ != websocket.MessageText {
			reason = "binary frame"
			ws.Close(websocket.StatusUnsupportedData, "text only")
			break
		}
		var in inFrame
		if json.Unmarshal(data, &in) != nil || in.T != "say" {
			reply("invalid")
			continue
		}
		if nick == "" {
			reply("readonly")
			continue
		}
		text, ok := Clean(in.Text)
		if !ok {
			reply("invalid")
			continue
		}
		now := h.now()
		tokens += float64(now.Sub(last)) / float64(rateEvery)
		if tokens > rateBurst {
			tokens = rateBurst
		}
		last = now
		if tokens < 1 {
			reply("rate")
			continue
		}
		tokens--
		select {
		case h.say <- encode(msgFrame{"msg", nick, text, now.UnixMilli()}):
			sent++
		case <-h.done:
		}
	}
	// Leave unless the hub already dropped this client (slow or shutdown).
	select {
	case h.leave <- c:
	case <-h.done:
	}
	cancel()
	if w := <-writerDone; w != "" {
		reason = w
	}
	ws.Close(websocket.StatusNormalClosure, "")
	return sent, reason
}

// write sends queued frames and keepalive pings. It returns a reason when the
// hub ended the connection.
func (h *Hub) write(ctx context.Context, ws *websocket.Conn, c *client) string {
	tick := time.NewTicker(h.ping)
	defer tick.Stop()
	for {
		// Replies to this connection only, before the room's traffic.
		select {
		case b := <-c.direct:
			if err := h.writeFrame(ctx, ws, b); err != nil {
				return writeFailed(ws, err)
			}
			continue
		default:
		}
		select {
		case b := <-c.direct:
			if err := h.writeFrame(ctx, ws, b); err != nil {
				return writeFailed(ws, err)
			}
		case b, ok := <-c.send:
			if !ok {
				if r := c.why.Load(); r != nil {
					ws.Close(r.code, r.text)
					return r.text
				}
				return ""
			}
			if err := h.writeFrame(ctx, ws, b); err != nil {
				return writeFailed(ws, err)
			}
		case <-tick.C:
			pctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := ws.Ping(pctx)
			cancel()
			if err != nil && ctx.Err() == nil {
				ws.CloseNow()
				return "ping timeout"
			}
		case <-ctx.Done():
			return ""
		}
	}
}

func (h *Hub) writeFrame(ctx context.Context, ws *websocket.Conn, b []byte) error {
	wctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, b)
}

// writeFailed ends a connection whose write failed; a stalled browser is
// named, any other failure means the connection is already gone.
func writeFailed(ws *websocket.Conn, err error) string {
	ws.CloseNow()
	if errors.Is(err, context.DeadlineExceeded) {
		return "write timeout"
	}
	return ""
}

// Clean trims a message and accepts it only when it is valid UTF-8 with
// 1..MaxRunes runes and no control or bidirectional-override characters.
func Clean(s string) (string, bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	s = strings.TrimSpace(s)
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) || isBidiControl(r) {
			return "", false
		}
		n++
	}
	return s, n >= 1 && n <= MaxRunes
}

func isBidiControl(r rune) bool {
	return (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) || r == 0x200E || r == 0x200F || r == 0x061C
}
