package relay

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

const testTicketSecret = "0123456789abcdef0123456789abcdef"

// Independent vector produced with Node's crypto (the portal's runtime):
// base64url(JSON.stringify(claims)) "." base64url(HMAC(label + payload)).
const nodeTicket = "eyJzdWIiOiI0MiIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMDYwLCJqdGkiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiJ9" +
	".dCuY1pK96hIGTu52hxgE5trHZ7hsrBRWEOmzd4oWdOg"

func portalHarness(t *testing.T) (*harness, *portalGate) {
	t.Helper()
	site := t.TempDir()
	write(t, site, "client.html", "page")
	write(t, site, "runtime.js", "js")
	h := newHarness(t, func(c *config.Config) {
		c.StaticDir = site
		c.PortalAuth = &config.PortalAuth{URL: "https://portal.example", TicketSecret: testTicketSecret}
		c.Defaults()
	})
	return h, h.gw.handler.(*portalGate)
}

func ticket(iat time.Time, life time.Duration, jti string) string {
	return sign([]byte(testTicketSecret), ticketLabel, ticketClaims{Sub: "42", Iat: iat.Unix(), Exp: iat.Add(life).Unix(), Jti: jti})
}

var noRedirect = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func postTicket(t *testing.T, base, tk string) *http.Response {
	t.Helper()
	resp, err := noRedirect.PostForm(base+portalPath, url.Values{"ticket": {tk}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func getWith(t *testing.T, u string, c *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	if c != nil {
		req.AddCookie(c)
	}
	resp, err := noRedirect.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp
}

func TestNodeTicketVector(t *testing.T) {
	var c ticketClaims
	if err := verify([]byte(testTicketSecret), ticketLabel, nodeTicket, &c); err != nil {
		t.Fatal(err)
	}
	if c.Sub != "42" || c.Iat != 1790000000 || c.Exp != 1790000060 || c.Jti != "00112233445566778899aabbccddeeff" {
		t.Fatalf("claims %+v", c)
	}
	if verify([]byte(testTicketSecret), sessionLabel, nodeTicket, &c) == nil {
		t.Fatal("ticket accepted under the session label")
	}
	if verify([]byte(strings.Replace(testTicketSecret, "0", "1", 1)), ticketLabel, nodeTicket, &c) == nil {
		t.Fatal("ticket accepted with another secret")
	}
}

func TestPortalGateFlow(t *testing.T) {
	h, _ := portalHarness(t)

	if resp := getWith(t, h.srv.URL+"/healthz", nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz: %d", resp.StatusCode)
	}
	for _, p := range []string{"/", "/client.html"} {
		resp := getWith(t, h.srv.URL+p, nil)
		if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "https://portal.example/jogar" {
			t.Fatalf("%s without session: %d %q", p, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	for _, p := range []string{"/runtime.js", "/config.json"} {
		if resp := getWith(t, h.srv.URL+p, nil); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s without session: %d", p, resp.StatusCode)
		}
	}
	if _, resp, err := h.dial("/ws/local", testOrigin); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("websocket without session was not refused: %v", err)
	}

	tk := ticket(time.Now(), time.Minute, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	resp := postTicket(t, h.srv.URL, tk)
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/" {
		t.Fatalf("ticket: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	var session *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == sessionName {
			session = c
		}
	}
	if session == nil || !session.HttpOnly || session.SameSite != http.SameSiteLaxMode || session.Path != "/" {
		t.Fatalf("session cookie %+v", session)
	}
	if resp := getWith(t, h.srv.URL+"/client.html", session); resp.StatusCode != http.StatusOK {
		t.Fatalf("page with session: %d", resp.StatusCode)
	}
	if resp := getWith(t, h.srv.URL+"/config.json", session); resp.StatusCode != http.StatusOK {
		t.Fatalf("config with session: %d", resp.StatusCode)
	}
	hdr := http.Header{"Origin": {testOrigin}, "Cookie": {session.String()}}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if ws, _, err := websocket.Dial(ctx, h.wsURL("/ws/local"), &websocket.DialOptions{HTTPHeader: hdr}); err != nil {
		t.Fatalf("websocket with session: %v", err)
	} else {
		ws.CloseNow()
	}

	// One use only.
	if resp := postTicket(t, h.srv.URL, tk); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed ticket: %d", resp.StatusCode)
	}
	// The session cookie is not a ticket and a ticket is not a session.
	if resp := postTicket(t, h.srv.URL, session.Value); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cookie as ticket: %d", resp.StatusCode)
	}
	fresh := ticket(time.Now(), time.Minute, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	if resp := getWith(t, h.srv.URL+"/config.json", &http.Cookie{Name: sessionName, Value: fresh}); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ticket as cookie: %d", resp.StatusCode)
	}
}

func TestPortalTicketRejects(t *testing.T) {
	h, _ := portalHarness(t)
	now := time.Now()
	good := ticket(now, time.Minute, "cccccccccccccccccccccccccccccccc")
	payload, sig, _ := strings.Cut(good, ".")
	cases := map[string]string{
		"empty":         "",
		"expired":       ticket(now.Add(-5*time.Minute), time.Minute, "dddddddddddddddddddddddddddddddd"),
		"future":        ticket(now.Add(5*time.Minute), time.Minute, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
		"long life":     ticket(now, time.Hour, "ffffffffffffffffffffffffffffffff"),
		"short jti":     ticket(now, time.Minute, "short"),
		"bad signature": payload + "." + strings.Repeat("A", len(sig)),
		"no signature":  payload,
		"extra dot":     good + ".x",
		"oversized":     strings.Repeat("a", maxTokenBytes+1),
		"not json":      "bm90LWpzb24." + base64.RawURLEncoding.EncodeToString(mac([]byte(testTicketSecret), ticketLabel, "bm90LWpzb24")),
		"no subject": sign([]byte(testTicketSecret), ticketLabel,
			ticketClaims{Iat: now.Unix(), Exp: now.Add(time.Minute).Unix(), Jti: "gggggggggggggggggggggggggggggggg"}),
	}
	for name, tk := range cases {
		t.Run(name, func(t *testing.T) {
			if resp := postTicket(t, h.srv.URL, tk); resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("accepted: %d", resp.StatusCode)
			}
		})
	}
	if resp := getWith(t, h.srv.URL+portalPath, nil); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET %s: %d", portalPath, resp.StatusCode)
	}
}

func TestPortalSessionExpires(t *testing.T) {
	_, gate := portalHarness(t)
	now := time.Now()
	gate.now = func() time.Time { return now }
	post := httptest.NewRequest(http.MethodPost, portalPath,
		strings.NewReader(url.Values{"ticket": {ticket(now, time.Minute, "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh")}}.Encode()))
	post.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, post)
	cookies := rec.Result().Cookies()
	// The harness is plain HTTP (allowInsecure), so the cookie is not Secure there.
	if rec.Code != http.StatusSeeOther || len(cookies) != 1 || cookies[0].Secure {
		t.Fatalf("ticket: %d %+v", rec.Code, cookies)
	}
	req := httptest.NewRequest(http.MethodGet, "/config.json", nil)
	req.AddCookie(cookies[0])
	gate.now = func() time.Time { return now.Add(13 * time.Hour) }
	rec = httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired session: %d", rec.Code)
	}
}

func TestPortalReplayCacheIsBounded(t *testing.T) {
	gate := &portalGate{key: []byte(testTicketSecret), now: time.Now, seen: map[string]time.Time{},
		log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	past := time.Now().Add(-time.Hour)
	for i := range maxSeenTickets {
		gate.seen[fmt.Sprintf("%032d", i)] = past
	}
	if _, err := gate.redeem(ticket(time.Now(), time.Minute, "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii")); err != nil {
		t.Fatalf("expired entries were not pruned: %v", err)
	}
	if len(gate.seen) != 1 {
		t.Fatalf("cache size %d", len(gate.seen))
	}
}

func TestPortalCookieSecureBehindTLS(t *testing.T) {
	cfg := &config.Config{TLSTerminatedByProxy: true,
		PortalAuth: &config.PortalAuth{URL: "https://portal.example", TicketSecret: testTicketSecret}}
	cfg.Defaults()
	if g := newPortalGate(cfg, http.NotFoundHandler(), slog.Default()); !g.secure || g.xff != "last" {
		t.Fatal("session cookie would not be Secure behind the TLS proxy")
	}
}
