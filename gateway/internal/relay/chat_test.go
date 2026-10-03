package relay

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

// lockedLog collects log lines written by the gateway's goroutines.
type lockedLog struct {
	mu sync.Mutex
	b  strings.Builder
}

func (l *lockedLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// dialChat opens /chat/ws like the page does: same origin, session cookie.
func (h *harness) dialChat(path, origin string, cookie *http.Cookie) (*websocket.Conn, *http.Response, error) {
	hdr := http.Header{}
	if origin != "" {
		hdr.Set("Origin", origin)
	}
	if cookie != nil {
		hdr.Set("Cookie", cookie.Name+"="+cookie.Value)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return websocket.Dial(ctx, h.wsURL(path), &websocket.DialOptions{HTTPHeader: hdr})
}

func readFrame(t *testing.T, ws *websocket.Conn, kind string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, b, err := ws.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		if m["t"] == kind {
			return m
		}
	}
}

func chatSession(t *testing.T, gate *portalGate, jti, name string) *http.Cookie {
	t.Helper()
	return redeemLogin(t, gate, loginTicket(time.Now(), jti, name, ""))[sessionName]
}

func TestChatNickFromSession(t *testing.T) {
	h, gate := portalHarness(t)
	logs := &lockedLog{}
	h.gw.log = slogTo(logs)
	alfa := chatSession(t, gate, strings.Repeat("a", 32), "alfa01")
	anon := chatSession(t, gate, strings.Repeat("b", 32), "")
	bad := chatSession(t, gate, strings.Repeat("c", 32), "Al<x>")

	a, _, err := h.dialChat("/chat/ws", testOrigin, alfa)
	if err != nil {
		t.Fatal(err)
	}
	defer a.CloseNow()
	if m := readFrame(t, a, "hello"); m["nick"] != "alfa01" || m["canSend"] != true {
		t.Fatalf("hello %v", m)
	}
	for _, c := range []*http.Cookie{anon, bad} {
		ro, _, err := h.dialChat("/chat/ws", testOrigin, c)
		if err != nil {
			t.Fatal(err)
		}
		defer ro.CloseNow()
		if m := readFrame(t, ro, "hello"); m["nick"] != "" || m["canSend"] != false {
			t.Fatalf("hello without a valid name %v", m)
		}
	}

	// The browser cannot choose its nick.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.Write(ctx, websocket.MessageText, []byte(`{"t":"say","text":"segredo-do-chat","nick":"admin"}`)); err != nil {
		t.Fatal(err)
	}
	if m := readFrame(t, a, "msg"); m["nick"] != "alfa01" || m["text"] != "segredo-do-chat" {
		t.Fatalf("msg %v", m)
	}
	a.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(logs.String(), "chat closed") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(logs.String(), "chat open") {
		t.Fatalf("chat not logged: %s", logs.String())
	}
	if strings.Contains(logs.String(), "segredo-do-chat") || strings.Contains(logs.String(), "alfa01") {
		t.Fatalf("chat text or nick logged: %s", logs.String())
	}
}

func TestChatRejectedRequests(t *testing.T) {
	h, gate := portalHarness(t)
	alfa := chatSession(t, gate, strings.Repeat("d", 32), "alfa01")
	cases := []struct {
		name, path, origin string
		cookie             *http.Cookie
		status             int
	}{
		{"no session", "/chat/ws", testOrigin, nil, http.StatusUnauthorized},
		{"foreign origin", "/chat/ws", "http://evil.test", alfa, http.StatusForbidden},
		{"missing origin", "/chat/ws", "", alfa, http.StatusForbidden},
		{"query", "/chat/ws?nick=admin", testOrigin, alfa, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, resp, err := h.dialChat(tc.path, tc.origin, tc.cookie)
			if err == nil {
				t.Fatal("upgrade unexpectedly succeeded")
			}
			if resp == nil || resp.StatusCode != tc.status {
				t.Fatalf("status = %v, want %d", resp, tc.status)
			}
		})
	}
}

func TestChatLimitsSeparateFromRelays(t *testing.T) {
	h := newHarness(t, func(c *config.Config) {
		c.Limits.MaxConnsPerIP = 1
		c.Chat.MaxPerIP = 1
	})
	// A game relay does not use the chat's slot, nor the other way round.
	h.open()
	c1, _, err := h.dialChat("/chat/ws", testOrigin, nil)
	if err != nil {
		t.Fatalf("chat beside a relay: %v", err)
	}
	// Without the portal gate there is no account: read-only.
	if m := readFrame(t, c1, "hello"); m["canSend"] != false {
		t.Fatalf("hello %v", m)
	}
	if _, resp, err := h.dialChat("/chat/ws", testOrigin, nil); err == nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("second chat from one IP: %v", resp)
	}
	c1.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(5 * time.Second)
	for {
		c2, _, err := h.dialChat("/chat/ws", testOrigin, nil)
		if err == nil {
			c2.CloseNow()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("chat slot not released: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestChatDisabled(t *testing.T) {
	off := false
	h := newHarness(t, func(c *config.Config) { c.Chat.Enabled = &off })
	if _, resp, err := h.dialChat("/chat/ws", testOrigin, nil); err == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("disabled chat answered: %v", resp)
	}
	if got := chatFlag(t, h); got {
		t.Fatal("config.json announces a disabled chat")
	}
	if !chatFlag(t, newHarness(t, nil)) {
		t.Fatal("config.json hides an enabled chat")
	}
}

func chatFlag(t *testing.T, h *harness) bool {
	t.Helper()
	resp, err := http.Get(h.srv.URL + "/config.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var c struct{ Chat *bool }
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil || c.Chat == nil {
		t.Fatalf("config.json without chat: %v", err)
	}
	return *c.Chat
}

func TestChatShutdown(t *testing.T) {
	h := newHarness(t, nil)
	c, _, err := h.dialChat("/chat/ws", testOrigin, nil)
	if err != nil {
		t.Fatal(err)
	}
	readFrame(t, c, "hello")
	h.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			if websocket.CloseStatus(err) != websocket.StatusGoingAway {
				t.Fatalf("close %v", err)
			}
			break
		}
	}
	done := make(chan struct{})
	go func() { h.gw.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("gateway did not release the chat on shutdown")
	}
}
