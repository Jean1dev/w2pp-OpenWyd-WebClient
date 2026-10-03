// Package relay forwards an ordered binary byte stream between a browser
// WebSocket and a configured tmserver TCP endpoint.
//
// The relay is deliberately protocol-blind: WebSocket messages and TCP reads do
// not delimit CPSock packets, and the client/server already frame, obfuscate
// and checksum. The gateway never decodes, rewrites, reorders or logs payload.
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/chat"
	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

// Gateway is the HTTP handler exposing /ws/{channel}, /chat/ws and /config.json.
type Gateway struct {
	cfg     *config.Config
	log     *slog.Logger
	baseCtx context.Context
	dial    func(ctx context.Context, network, addr string) (net.Conn, error)
	origins map[string]bool
	mux     *http.ServeMux
	handler http.Handler

	relays limiter
	chats  limiter
	chat   *chat.Hub
	nextID atomic.Uint64
	active sync.WaitGroup
	live   atomic.Int64
}

// New builds a gateway. baseCtx cancellation closes every active relay.
func New(baseCtx context.Context, cfg *config.Config, log *slog.Logger) *Gateway {
	g := &Gateway{
		cfg:     cfg,
		log:     log,
		baseCtx: baseCtx,
		origins: make(map[string]bool, len(cfg.AllowedOrigins)),
		relays:  newLimiter(cfg.Limits.MaxConns, cfg.Limits.MaxConnsPerIP),
		chats:   newLimiter(cfg.Chat.MaxClients, cfg.Chat.MaxPerIP),
		mux:     http.NewServeMux(),
	}
	d := &net.Dialer{Timeout: cfg.Limits.DialTimeout.Std(), KeepAlive: 30 * time.Second}
	g.dial = d.DialContext
	for _, o := range cfg.AllowedOrigins {
		g.origins[trimSlash(o)] = true
	}
	g.mux.HandleFunc("GET /ws/{channel}", g.handleWS)
	g.mux.HandleFunc("GET /config.json", g.handleConfig)
	if cfg.Chat.On() {
		g.chat = chat.NewHub(log)
		g.active.Add(1)
		go func() {
			defer g.active.Done()
			g.chat.Run(baseCtx)
		}()
		g.mux.HandleFunc("GET /chat/ws", g.handleChat)
	}
	if cfg.StaticDir != "" {
		var assets http.Handler
		switch {
		case cfg.AssetS3 != nil:
			assets = newS3Assets(*cfg.AssetS3, cfg.Limits.DialTimeout.Std(), log)
		case cfg.AssetDir != "":
			assets = http.FileServer(http.Dir(cfg.AssetDir))
		}
		g.mux.Handle("GET /", staticHandler(cfg.StaticDir, assets))
	}
	g.handler = g.mux
	switch {
	case cfg.BasicAuth != nil:
		g.handler = basicAuth(*cfg.BasicAuth, g.mux)
	case cfg.PortalAuth != nil:
		g.handler = newPortalGate(cfg, g.mux, log)
	}
	return g
}

// ServeHTTP implements http.Handler. /healthz answers without credentials so
// the platform can probe liveness; it reveals nothing about the targets.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, "ok\n")
		return
	}
	g.handler.ServeHTTP(w, r)
}

// Live reports the number of relays currently open (for tests and metrics).
func (g *Gateway) Live() int64 { return g.live.Load() }

// Wait blocks until every relay has fully released its resources.
func (g *Gateway) Wait() { g.active.Wait() }

type browserConfig struct {
	Channel              string `json:"channel"`
	WSURL                string `json:"wsUrl"`
	ClientVersion        int    `json:"clientVersion"`
	AssetManifestVersion string `json:"assetManifestVersion,omitempty"`
	// Chat tells the page whether /chat/ws exists (ADR 018).
	Chat bool `json:"chat"`
}

// handleConfig tells the page which endpoint and protocol version to use. The
// TCP destination is intentionally absent.
func (g *Gateway) handleConfig(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("channel")
	if name == "" {
		name = g.cfg.DefaultChannel
	}
	ch, ok := g.cfg.Channel(name)
	if !ok {
		http.Error(w, "unknown channel", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(browserConfig{
		Channel:              ch.Name,
		WSURL:                ch.PublicWSURL,
		ClientVersion:        ch.ClientVersion,
		AssetManifestVersion: g.cfg.AssetManifestVersion,
		Chat:                 g.chat != nil,
	})
}

func (g *Gateway) handleWS(w http.ResponseWriter, r *http.Request) {
	// The upstream client appended ?host=&port= for its debug proxy. Refuse any
	// query outright so a stale client cannot look like it is choosing a target.
	if r.URL.RawQuery != "" {
		http.Error(w, "query parameters are not accepted", http.StatusBadRequest)
		return
	}
	ch, ok := g.cfg.Channel(r.PathValue("channel"))
	if !ok {
		http.Error(w, "unknown channel", http.StatusNotFound)
		return
	}
	origin := r.Header.Get("Origin")
	if !g.origins[trimSlash(origin)] {
		g.log.Warn("origin rejected", "channel", ch.Name, "origin", origin)
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	ip := remoteIP(r, forwardedFor(g.cfg))
	if !g.relays.acquire(ip) {
		g.log.Warn("connection limit", "channel", ch.Name, "ip", ip)
		http.Error(w, "too many connections", http.StatusServiceUnavailable)
		return
	}
	defer g.relays.release(ip)
	// Count the relay before the upgrade hijacks the connection: from then on
	// http.Server.Shutdown no longer waits for this handler, so a later Add
	// could race Wait and let shutdown return while a relay is starting.
	g.active.Add(1)
	defer g.active.Done()

	// Dial before upgrading so an unreachable server is a plain HTTP error.
	dctx, cancel := context.WithTimeout(r.Context(), g.cfg.Limits.DialTimeout.Std())
	tcp, err := g.dial(dctx, "tcp", ch.Target)
	cancel()
	if err != nil {
		g.log.Warn("dial failed", "channel", ch.Name, "err", err)
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Origin was checked above against the exact allowlist, which is
		// stricter than the library's host-pattern check.
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		tcp.Close()
		g.log.Warn("websocket accept failed", "channel", ch.Name, "err", err)
		return
	}

	g.live.Add(1)
	defer g.live.Add(-1)
	g.run(ch, ip, ws, tcp)
}

// handleChat joins the page chat (ADR 018). The nick is the portal account's
// login name from the session; without one the connection is read-only.
func (g *Gateway) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		http.Error(w, "query parameters are not accepted", http.StatusBadRequest)
		return
	}
	if !g.origins[trimSlash(r.Header.Get("Origin"))] {
		g.log.Warn("chat origin rejected", "origin", r.Header.Get("Origin"))
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	ip := remoteIP(r, forwardedFor(g.cfg))
	if !g.chats.acquire(ip) {
		g.log.Warn("chat connection limit", "ip", ip)
		http.Error(w, "too many connections", http.StatusServiceUnavailable)
		return
	}
	defer g.chats.release(ip)
	// Counted before the upgrade hijacks the connection, as in handleWS.
	g.active.Add(1)
	defer g.active.Done()
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Origin checked above against the exact allowlist.
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		g.log.Warn("chat websocket accept failed", "err", err)
		return
	}
	nick := ""
	if id, ok := identityFrom(r.Context()); ok {
		nick = id.Name
	}
	id := g.nextID.Add(1)
	start := time.Now()
	// Neither the nick nor any text is logged; only counts and the reason.
	g.log.Info("chat open", "conn", id, "ip", ip, "canSend", nick != "")
	sent, reason := g.chat.Serve(context.Background(), ws, nick)
	g.log.Info("chat closed", "conn", id, "reason", reason, "sent", sent,
		"duration", time.Since(start).Round(time.Millisecond))
}

// run pumps both directions until either side ends, then closes both.
func (g *Gateway) run(ch config.Channel, ip string, ws *websocket.Conn, tcp net.Conn) {
	id := g.nextID.Add(1)
	start := time.Now()
	// The pair's context is cancelled only by closeBoth. Deriving it from
	// baseCtx would let the library hard-close the WebSocket on shutdown
	// (NetConn closes the conn when its context ends), racing the clean
	// close below; shutdown is observed through baseCtx in the loop instead.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	browser := websocket.NetConn(ctx, ws, websocket.MessageBinary)
	lim := g.cfg.Limits
	// NetConn disables the read limit (coder/websocket netconn.go); restore it.
	ws.SetReadLimit(lim.MaxMessageBytes)
	var lastActive atomic.Int64
	lastActive.Store(time.Now().UnixNano())

	var once sync.Once
	reason := "unknown"
	// closeBoth ends the pair. A clean end sends a WebSocket close frame after
	// every relayed byte, so the client can tell EOF from a network failure;
	// any other end tears the WebSocket down immediately.
	closeBoth := func(why string, clean bool) {
		once.Do(func() {
			reason = why
			tcp.Close()
			if clean {
				ws.Close(websocket.StatusNormalClosure, "")
			} else {
				ws.CloseNow()
			}
			cancel()
		})
	}

	g.log.Info("relay open", "conn", id, "channel", ch.Name, "ip", ip)
	var up, down atomic.Int64
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		err := pump(tcp, browser, lim.BufferBytes, lim.WriteTimeout.Std(), &up, &lastActive)
		closeBoth(describe("browser", err), false)
	}()
	go func() {
		defer wg.Done()
		err := pump(browser, tcp, lim.BufferBytes, lim.WriteTimeout.Std(), &down, &lastActive)
		closeBoth(describe("server", err), err == nil || errors.Is(err, io.EOF))
	}()

	// Idle watchdog: activity in either direction keeps the pair alive, so a
	// server-only stream (player standing still) is not cut off.
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	tick := time.NewTicker(idleCheckInterval(lim.IdleTimeout.Std()))
	defer tick.Stop()
loop:
	for {
		select {
		case <-done:
			break loop
		case <-ctx.Done():
			// A pump already closed both sides.
			<-done
			break loop
		case <-g.baseCtx.Done():
			closeBoth("shutdown", true)
			<-done
			break loop
		case <-tick.C:
			if time.Since(time.Unix(0, lastActive.Load())) > lim.IdleTimeout.Std() {
				closeBoth("idle timeout", true)
			}
		}
	}
	g.log.Info("relay closed", "conn", id, "channel", ch.Name, "reason", reason,
		"bytes_up", up.Load(), "bytes_down", down.Load(), "duration", time.Since(start).Round(time.Millisecond))
}

// pump copies src to dst with one fixed buffer. A slow dst blocks the reader,
// which in turn fills the peer's TCP window: backpressure without a queue. A
// write stalled beyond writeTimeout ends the relay.
func pump(dst, src net.Conn, bufSize int, writeTimeout time.Duration, n *atomic.Int64, last *atomic.Int64) error {
	buf := make([]byte, bufSize)
	for {
		r, rerr := src.Read(buf)
		if r > 0 {
			last.Store(time.Now().UnixNano())
			if err := dst.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				return err
			}
			w, werr := dst.Write(buf[:r])
			n.Add(int64(w))
			if werr != nil {
				return errWrite{werr}
			}
			last.Store(time.Now().UnixNano())
		}
		if rerr != nil {
			return rerr
		}
	}
}

type errWrite struct{ err error }

func (e errWrite) Error() string { return "write: " + e.err.Error() }
func (e errWrite) Unwrap() error { return e.err }

// describe names which side ended the relay without including payload.
func describe(src string, err error) string {
	var we errWrite
	switch {
	case errors.As(err, &we):
		if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
			return "write timeout toward " + other(src)
		}
		return "write error toward " + other(src)
	case err == nil, errors.Is(err, io.EOF):
		return src + " closed"
	case websocket.CloseStatus(err) != -1:
		return src + " closed: " + websocket.CloseStatus(err).String()
	default:
		return src + " error"
	}
}

func other(side string) string {
	if side == "browser" {
		return "server"
	}
	return "browser"
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func idleCheckInterval(idle time.Duration) time.Duration {
	iv := idle / 4
	if iv < 10*time.Millisecond {
		iv = 10 * time.Millisecond
	}
	if iv > 5*time.Second {
		iv = 5 * time.Second
	}
	return iv
}

// limiter bounds connections in total and per client IP.
type limiter struct {
	mu            sync.Mutex
	max, maxPerIP int
	total         int
	perIP         map[string]int
}

func newLimiter(max, maxPerIP int) limiter {
	return limiter{max: max, maxPerIP: maxPerIP, perIP: map[string]int{}}
}

func (l *limiter) acquire(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.total >= l.max || l.perIP[ip] >= l.maxPerIP {
		return false
	}
	l.total++
	l.perIP[ip]++
	return true
}

func (l *limiter) release(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.total--
	if l.perIP[ip]--; l.perIP[ip] <= 0 {
		delete(l.perIP, ip)
	}
}

// remoteIP uses the socket peer. Forwarded headers are trusted only when the
// operator declared a TLS-terminating platform proxy (tlsTerminatedByProxy):
// then the peer is always that proxy, and the rightmost X-Forwarded-For entry
// is the one the proxy appended (a client can only prepend forged entries).
// Without that declaration the per-IP limit degrades to per-proxy, which is safe.
// forwardedFor is the X-Forwarded-For entry trusted as the client: "" (the
// header is ignored), "last" or "first".
func forwardedFor(cfg *config.Config) string {
	switch {
	case !cfg.TLSTerminatedByProxy:
		return ""
	case cfg.ForwardedFor == "":
		return "last"
	}
	return cfg.ForwardedFor
}

func remoteIP(r *http.Request, xff string) string {
	if values := r.Header.Values("X-Forwarded-For"); xff != "" && len(values) > 0 {
		parts := strings.Split(strings.Join(values, ","), ",")
		entry := parts[len(parts)-1]
		if xff == "first" {
			entry = parts[0]
		}
		if ip := net.ParseIP(strings.TrimSpace(entry)); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
