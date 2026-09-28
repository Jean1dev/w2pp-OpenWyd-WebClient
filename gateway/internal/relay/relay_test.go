package relay

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

const testOrigin = "http://client.test"

// handshake and packets are opaque bytes to the relay; they only need to look
// like real CPSock traffic so boundaries are meaningful to the reader.
var handshake = []byte{0x11, 0xF3, 0x11, 0x1F}

func packet(size int, fill byte) []byte {
	p := bytes.Repeat([]byte{fill}, size)
	p[0], p[1] = byte(size), byte(size>>8)
	return p
}

type harness struct {
	t      *testing.T
	gw     *Gateway
	srv    *httptest.Server
	ln     net.Listener
	accept chan net.Conn
	cancel context.CancelFunc
}

func newHarness(t *testing.T, mutate func(*config.Config)) *harness {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		Listen:         "127.0.0.1:0",
		AllowInsecure:  true,
		AllowedOrigins: []string{testOrigin},
		Channels: []config.Channel{{
			Name: "local", Target: ln.Addr().String(),
			PublicWSURL: "ws://127.0.0.1/ws/local", ClientVersion: 12000,
		}},
	}
	cfg.Defaults()
	cfg.Limits.WriteTimeout = config.Duration(300 * time.Millisecond)
	if mutate != nil {
		mutate(cfg)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := &harness{t: t, gw: New(ctx, cfg, log), ln: ln, accept: make(chan net.Conn, 8), cancel: cancel}
	h.srv = httptest.NewServer(h.gw)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			h.accept <- c
		}
	}()
	t.Cleanup(func() {
		cancel()
		h.srv.Close()
		ln.Close()
		h.gw.Wait()
	})
	return h
}

func (h *harness) wsURL(path string) string {
	return "ws" + strings.TrimPrefix(h.srv.URL, "http") + path
}

func (h *harness) dial(path, origin string) (*websocket.Conn, *http.Response, error) {
	hdr := http.Header{}
	if origin != "" {
		hdr.Set("Origin", origin)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return websocket.Dial(ctx, h.wsURL(path), &websocket.DialOptions{HTTPHeader: hdr})
}

func (h *harness) open() (*websocket.Conn, net.Conn) {
	h.t.Helper()
	ws, _, err := h.dial("/ws/local", testOrigin)
	if err != nil {
		h.t.Fatalf("dial: %v", err)
	}
	select {
	case c := <-h.accept:
		h.t.Cleanup(func() { c.Close(); ws.CloseNow() })
		return ws, c
	case <-time.After(5 * time.Second):
		h.t.Fatal("tcp side never connected")
	}
	return nil, nil
}

func (h *harness) waitIdle() {
	h.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for h.gw.Live() != 0 {
		if time.Now().After(deadline) {
			h.t.Fatalf("relay still live: %d", h.gw.Live())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRejectedRequests(t *testing.T) {
	h := newHarness(t, nil)
	cases := []struct {
		name, path, origin string
		status             int
	}{
		{"client-chosen target", "/ws/local?host=10.0.0.1&port=8281", testOrigin, http.StatusBadRequest},
		{"any query", "/ws/local?x=1", testOrigin, http.StatusBadRequest},
		{"unknown channel", "/ws/other", testOrigin, http.StatusNotFound},
		{"foreign origin", "/ws/local", "http://evil.test", http.StatusForbidden},
		{"origin prefix trick", "/ws/local", testOrigin + ".evil.test", http.StatusForbidden},
		{"missing origin", "/ws/local", "", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, resp, err := h.dial(tc.path, tc.origin)
			if err == nil {
				t.Fatal("upgrade unexpectedly succeeded")
			}
			if resp == nil || resp.StatusCode != tc.status {
				t.Fatalf("status = %v, want %d", resp, tc.status)
			}
		})
	}
	select {
	case <-h.accept:
		t.Fatal("rejected request reached the TCP target")
	case <-time.After(50 * time.Millisecond):
	}
}

// TestBrowserToServerByteExact sends the handshake and packets split at every
// header boundary and glued together; the server must see the exact stream.
func TestBrowserToServerByteExact(t *testing.T) {
	h := newHarness(t, nil)
	ws, tcp := h.open()
	ctx := context.Background()

	var want bytes.Buffer
	send := func(b []byte) {
		t.Helper()
		if err := ws.Write(ctx, websocket.MessageBinary, b); err != nil {
			t.Fatal(err)
		}
		want.Write(b)
	}
	send(handshake[:1])
	send(handshake[1:])
	for k := 1; k < 12; k++ {
		p := packet(40, byte(k))
		send(p[:k])
		send(p[k:])
	}
	glued := append(append(packet(12, 0xA1), packet(116, 0xA2)...), packet(8192, 0xA3)...)
	send(glued)
	partial := packet(52, 0xEE)
	send(partial[:30])

	got := make([]byte, want.Len())
	tcp.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(tcp, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want.Bytes()) {
		t.Fatal("server received bytes differ from browser stream")
	}
	// Browser disconnects mid-packet: server sees EOF, relay releases.
	ws.Close(websocket.StatusNormalClosure, "")
	if n, err := tcp.Read(make([]byte, 1)); err == nil {
		t.Fatalf("server read %d bytes after close, want EOF", n)
	}
	h.waitIdle()
}

// TestServerToBrowserByteExact: several packets per TCP write, a packet
// dribbled byte by byte, then a partial packet and server close.
func TestServerToBrowserByteExact(t *testing.T) {
	h := newHarness(t, nil)
	ws, tcp := h.open()

	var want bytes.Buffer
	write := func(b []byte) {
		t.Helper()
		if _, err := tcp.Write(b); err != nil {
			t.Fatal(err)
		}
		want.Write(b)
	}
	write(append(append(packet(2008, 0x10), packet(232, 0x11)...), packet(12, 0x12)...))
	for _, b := range packet(52, 0x13) {
		write([]byte{b})
	}
	write(packet(1832, 0x14)[:700])
	tcp.Close()

	var got bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		typ, b, err := ws.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == -1 {
				t.Fatalf("read ended without close frame: %v", err)
			}
			break
		}
		if typ != websocket.MessageBinary {
			t.Fatalf("got message type %v", typ)
		}
		got.Write(b)
	}
	if !bytes.Equal(got.Bytes(), want.Bytes()) {
		t.Fatalf("browser received %d bytes, want %d identical", got.Len(), want.Len())
	}
	h.waitIdle()
}

func TestTextMessageClosesBoth(t *testing.T) {
	h := newHarness(t, nil)
	ws, tcp := h.open()
	if err := ws.Write(context.Background(), websocket.MessageText, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	tcp.SetReadDeadline(time.Now().Add(5 * time.Second))
	if n, err := tcp.Read(make([]byte, 16)); err == nil {
		t.Fatalf("text payload reached server (%d bytes)", n)
	}
	h.waitIdle()
}

func TestOversizedMessageClosesBoth(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.Limits.MaxMessageBytes = 8192 })
	ws, tcp := h.open()
	_ = ws.Write(context.Background(), websocket.MessageBinary, make([]byte, 8193))
	tcp.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadAll(tcp); err != nil && !errors.Is(err, net.ErrClosed) && !isReset(err) {
		t.Fatalf("unexpected server read error: %v", err)
	}
	h.waitIdle()
}

func TestConnectionLimits(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.Limits.MaxConns = 2; c.Limits.MaxConnsPerIP = 1 })
	ws, _ := h.open()
	if _, resp, err := h.dial("/ws/local", testOrigin); err == nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("second connection from same IP: err=%v resp=%v", err, resp)
	}
	ws.Close(websocket.StatusNormalClosure, "")
	h.waitIdle()
	// The slot is released: a new connection succeeds.
	h.open()
}

func TestDialFailureReleasesSlot(t *testing.T) {
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := dead.Addr().String()
	dead.Close()
	h := newHarness(t, func(c *config.Config) {
		c.Channels[0].Target = addr
		c.Limits.MaxConns, c.Limits.MaxConnsPerIP = 1, 1
	})
	for i := 0; i < 3; i++ {
		_, resp, err := h.dial("/ws/local", testOrigin)
		if err == nil || resp.StatusCode != http.StatusBadGateway {
			t.Fatalf("attempt %d: err=%v resp=%v", i, err, resp)
		}
	}
}

// TestSlowServerBackpressure: the tmserver stops reading. The relay must not
// buffer without bound; the write deadline ends the pair.
func TestSlowServerBackpressure(t *testing.T) {
	h := newHarness(t, nil)
	ws, _ := h.open()
	errc := make(chan error, 1)
	go func() {
		chunk := make([]byte, 60<<10)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		for {
			if err := ws.Write(ctx, websocket.MessageBinary, chunk); err != nil {
				errc <- err
				return
			}
		}
	}()
	select {
	case <-errc:
	case <-time.After(20 * time.Second):
		t.Fatal("browser writes never blocked/failed against a non-reading server")
	}
	h.waitIdle()
}

// TestSlowBrowserBackpressure: the browser stops reading while the server floods.
func TestSlowBrowserBackpressure(t *testing.T) {
	h := newHarness(t, nil)
	_, tcp := h.open()
	errc := make(chan error, 1)
	go func() {
		chunk := make([]byte, 64<<10)
		tcp.SetWriteDeadline(time.Now().Add(20 * time.Second))
		for {
			if _, err := tcp.Write(chunk); err != nil {
				errc <- err
				return
			}
		}
	}()
	select {
	case err := <-errc:
		if isTimeout(err) {
			t.Fatal("server write timed out: relay never closed the stalled pair")
		}
	case <-time.After(25 * time.Second):
		t.Fatal("server flood never stopped")
	}
	h.waitIdle()
}

func TestIdleTimeoutClosesBoth(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.Limits.IdleTimeout = config.Duration(150 * time.Millisecond) })
	ws, tcp := h.open()
	tcp.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := tcp.Read(make([]byte, 1)); err == nil || isTimeout(err) {
		t.Fatalf("server side not closed by idle timeout: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, _, err := ws.Read(ctx); err == nil {
		t.Fatal("browser side not closed by idle timeout")
	}
	h.waitIdle()
}

func TestShutdownClosesRelays(t *testing.T) {
	h := newHarness(t, nil)
	_, tcp := h.open()
	h.cancel()
	tcp.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := tcp.Read(make([]byte, 1)); err == nil || isTimeout(err) {
		t.Fatalf("shutdown did not close server side: %v", err)
	}
	h.waitIdle()
}

func TestConfigEndpointHidesTarget(t *testing.T) {
	h := newHarness(t, nil)
	resp, err := http.Get(h.srv.URL + "/config.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	s := string(body)
	if !strings.Contains(s, `"clientVersion":12000`) || !strings.Contains(s, `"wsUrl":"ws://127.0.0.1/ws/local"`) {
		t.Fatalf("unexpected config: %s", s)
	}
	if strings.Contains(s, h.ln.Addr().String()) {
		t.Fatalf("config leaks TCP target: %s", s)
	}
}

func isReset(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "reset") || strings.Contains(err.Error(), "forcibly closed"))
}
