package chat

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// room serves a hub over httptest; the nick comes from the URL path here,
// standing in for the gateway session.
type room struct {
	t      *testing.T
	hub    *Hub
	srv    *httptest.Server
	cancel context.CancelFunc
	mu     sync.Mutex
	ends   []string
	wg     sync.WaitGroup
}

func newRoom(t *testing.T) *room {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	r := &room{t: t, hub: NewHub(slog.New(slog.NewTextHandler(io.Discard, nil))), cancel: cancel}
	done := make(chan struct{})
	go func() { r.hub.Run(ctx); close(done) }()
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ws, err := websocket.Accept(w, req, nil)
		if err != nil {
			return
		}
		r.wg.Add(1)
		defer r.wg.Done()
		_, reason := r.hub.Serve(context.Background(), ws, strings.TrimPrefix(req.URL.Path, "/"))
		r.mu.Lock()
		r.ends = append(r.ends, reason)
		r.mu.Unlock()
	}))
	t.Cleanup(func() {
		cancel()
		<-done
		r.srv.Close()
		r.wg.Wait()
	})
	return r
}

type peer struct {
	t  *testing.T
	ws *websocket.Conn
}

func (r *room) join(nick string) *peer {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(r.srv.URL, "http")+"/"+nick, nil)
	if err != nil {
		r.t.Fatal(err)
	}
	r.t.Cleanup(func() { ws.CloseNow() })
	p := &peer{t: r.t, ws: ws}
	hello := p.next()
	if hello["t"] != "hello" || hello["nick"] != nick || hello["canSend"] != (nick != "") {
		r.t.Fatalf("hello %v", hello)
	}
	return p
}

func (p *peer) next() map[string]any {
	p.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, b, err := p.ws.Read(ctx)
	if err != nil {
		p.t.Fatalf("read: %v", err)
	}
	if typ != websocket.MessageText {
		p.t.Fatalf("frame type %v", typ)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		p.t.Fatal(err)
	}
	return m
}

// until skips frames of other kinds (online counts) up to the first of kind t.
func (p *peer) until(t string) map[string]any {
	p.t.Helper()
	for {
		if m := p.next(); m["t"] == t {
			return m
		}
	}
}

func (p *peer) online(n int) {
	p.t.Helper()
	for {
		m := p.until("online")
		if int(m["n"].(float64)) == n {
			return
		}
	}
}

func (p *peer) send(raw string) {
	p.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.ws.Write(ctx, websocket.MessageText, []byte(raw)); err != nil {
		p.t.Fatal(err)
	}
}

func (p *peer) say(text string) {
	b, _ := json.Marshal(map[string]string{"t": "say", "text": text})
	p.send(string(b))
}

func TestBroadcastAndEcho(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	a.online(1)
	b := r.join("beta02")
	a.online(2)
	b.online(2)

	// A nick in the frame is ignored: the server's nick wins.
	a.send(`{"t":"say","text":"  oi <b>todos</b>  ","nick":"admin"}`)
	for _, p := range []*peer{a, b} {
		m := p.until("msg")
		if m["nick"] != "alfa01" || m["text"] != "oi <b>todos</b>" || m["ts"].(float64) <= 0 {
			t.Fatalf("msg %v", m)
		}
	}
	b.say("olá, ação ✓")
	if m := a.until("msg"); m["nick"] != "beta02" || m["text"] != "olá, ação ✓" {
		t.Fatalf("msg %v", m)
	}

	b.ws.Close(websocket.StatusNormalClosure, "")
	a.online(1)
}

func TestValidation(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	for _, raw := range []string{
		`{"t":"say","text":""}`,
		`{"t":"say","text":"   "}`,
		`{"t":"say","text":"` + strings.Repeat("x", MaxRunes+1) + `"}`,
		`{"t":"say","text":"a\u0007b"}`,
		`{"t":"say","text":"a\nb"}`,
		`{"t":"say","text":"abc‮def"}`,
		`{"t":"nick","text":"x"}`,
		`not json`,
	} {
		a.send(raw)
		if m := a.until("error"); m["code"] != "invalid" {
			t.Fatalf("%s: %v", raw, m)
		}
	}
	// Invalid UTF-8 reaches Clean as a raw string.
	if _, ok := Clean("a\xffb"); ok {
		t.Fatal("invalid UTF-8 accepted")
	}
	if s, ok := Clean(strings.Repeat("é", MaxRunes)); !ok || len([]rune(s)) != MaxRunes {
		t.Fatal("200 runes refused")
	}
	// The connection survives every refusal.
	a.say("ainda aqui")
	if m := a.until("msg"); m["text"] != "ainda aqui" {
		t.Fatalf("msg %v", m)
	}
}

func TestReadOnlyWithoutNick(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	ro := r.join("")
	ro.say("posso?")
	if m := ro.until("error"); m["code"] != "readonly" {
		t.Fatalf("%v", m)
	}
	a.say("pode ler")
	if m := ro.until("msg"); m["text"] != "pode ler" {
		t.Fatalf("%v", m)
	}
}

func TestRateLimit(t *testing.T) {
	r := newRoom(t)
	now := time.Unix(1790000000, 0)
	var mu sync.Mutex
	// Set before any connection exists; later changes go through mu.
	r.hub.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	a := r.join("alfa01")
	for i := 0; i < rateBurst; i++ {
		a.say("x")
		a.until("msg")
	}
	a.say("demais")
	if m := a.until("error"); m["code"] != "rate" {
		t.Fatalf("%v", m)
	}
	mu.Lock()
	now = now.Add(rateEvery)
	mu.Unlock()
	a.say("de novo")
	if m := a.until("msg"); m["text"] != "de novo" {
		t.Fatalf("%v", m)
	}
}

// A client that stops draining its queue is dropped by the hub without
// delaying anyone else. Driven at the hub's channels: on loopback the socket
// buffers would absorb megabytes before the queue ever filled.
func TestSlowClientDropped(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	a.online(1)
	slow := &client{send: make(chan []byte, sendQueue), direct: make(chan []byte, directQueue)}
	r.hub.join <- slow
	a.online(2)
	// The slow queue also holds its own "online 2", so it fills one message early.
	dropped := false
	for i := 0; i <= sendQueue; i++ {
		r.hub.say <- encode(msgFrame{"msg", "beta02", "x", 1})
		for m := a.next(); m["t"] != "msg"; m = a.next() {
			dropped = dropped || (m["t"] == "online" && m["n"] == 1.0)
		}
	}
	if !dropped {
		t.Fatal("no online count after the drop")
	}
	n := 0
	for range slow.send {
		n++
	}
	if why := slow.why.Load(); why != reasonSlow || n != sendQueue {
		t.Fatalf("slow client: why=%v queued=%d", why, n)
	}
}

func TestBinaryFrameCloses(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.ws.Write(ctx, websocket.MessageBinary, []byte{1, 2}); err != nil {
		t.Fatal(err)
	}
	for {
		if _, _, err := a.ws.Read(ctx); err != nil {
			if websocket.CloseStatus(err) != websocket.StatusUnsupportedData {
				t.Fatalf("close %v", err)
			}
			return
		}
	}
}

func TestShutdownClosesClients(t *testing.T) {
	r := newRoom(t)
	a := r.join("alfa01")
	a.online(1)
	r.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := a.ws.Read(ctx); err != nil {
			if websocket.CloseStatus(err) != websocket.StatusGoingAway {
				t.Fatalf("close %v", err)
			}
			return
		}
	}
}
