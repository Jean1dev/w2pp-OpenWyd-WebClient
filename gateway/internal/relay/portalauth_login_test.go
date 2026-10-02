package relay

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Ticket with a game login, signed with Node's crypto by the portal
// (wyd-plataforma src/lib/play-ticket.ts, issuePlayTicket with a login).
const nodeLoginTicket = "eyJzdWIiOiI0MiIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMDYwLCJqdGkiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsIm5hbWUiOiJhbGljZSIsImNvZGUiOiJhYmNkZWZnaDI5In0" +
	".SNXd1yxL4t0bzpKCcMNdJ5MssEpwA7uDaaWq8D0vG2E"

func TestNodeLoginTicketVector(t *testing.T) {
	var c ticketClaims
	if err := verify([]byte(testTicketSecret), ticketLabel, nodeLoginTicket, &c); err != nil {
		t.Fatal(err)
	}
	if c.Sub != "42" || c.Name != "alice" || c.Code != "abcdefgh29" {
		t.Fatalf("claims %+v", c)
	}
}

func loginTicket(now time.Time, jti, name, code string) string {
	return sign([]byte(testTicketSecret), ticketLabel, ticketClaims{
		Sub: "42", Iat: now.Unix(), Exp: now.Add(time.Minute).Unix(), Jti: jti, Name: name, Code: code,
	})
}

// redeemLogin posts a ticket to the gate and returns the response cookies by name.
func redeemLogin(t *testing.T, gate *portalGate, tk string) map[string]*http.Cookie {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, portalPath, strings.NewReader(url.Values{"ticket": {tk}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("ticket: %d", rec.Code)
	}
	out := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		out[c.Name] = c
	}
	return out
}

func gameLogin(gate *portalGate, method, origin string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, loginPath, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for _, c := range cookies {
		if c != nil {
			req.AddCookie(c)
		}
	}
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	return rec
}

func TestGameLoginHandoff(t *testing.T) {
	_, gate := portalHarness(t)
	now := time.Now()
	c := redeemLogin(t, gate, loginTicket(now, "jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj", "alice", "abcdefgh29"))
	session, login := c[sessionName], c[loginName]
	if session == nil || login == nil {
		t.Fatalf("cookies %v", c)
	}
	if !login.HttpOnly || login.SameSite != http.SameSiteStrictMode || login.Path != loginPath ||
		login.MaxAge != int(loginTTL/time.Second) || len(login.Value) != 2*handoffIDLen {
		t.Fatalf("login cookie %+v", login)
	}

	// Needs the session, POST and the page's own origin.
	if rec := gameLogin(gate, http.MethodPost, "", login); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without session: %d", rec.Code)
	}
	if rec := gameLogin(gate, http.MethodGet, "", session, login); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", rec.Code)
	}
	if rec := gameLogin(gate, http.MethodPost, "https://evil.example", session, login); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", rec.Code)
	}

	rec := gameLogin(gate, http.MethodPost, "http://example.com", session, login)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("handoff: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	var got struct{ Account, Code string }
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil || got.Account != "alice" || got.Code != "abcdefgh29" {
		t.Fatalf("body %+v err=%v", got, err)
	}
	cleared := false
	for _, ck := range rec.Result().Cookies() {
		cleared = cleared || (ck.Name == loginName && ck.MaxAge < 0)
	}
	if !cleared {
		t.Fatal("login cookie was not cleared")
	}

	// Once only.
	if rec := gameLogin(gate, http.MethodPost, "", session, login); rec.Code != http.StatusNoContent {
		t.Fatalf("second handoff: %d", rec.Code)
	}
	if len(gate.handoffs) != 0 {
		t.Fatalf("%d handoffs left", len(gate.handoffs))
	}
}

func TestGameLoginRefusals(t *testing.T) {
	_, gate := portalHarness(t)
	now := time.Now()
	gate.now = func() time.Time { return now }

	// A plain ticket (no login) behaves as before: no login cookie, 204.
	c := redeemLogin(t, gate, ticket(now, time.Minute, "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"))
	if c[loginName] != nil {
		t.Fatal("login cookie for a ticket without login")
	}
	if rec := gameLogin(gate, http.MethodPost, "", c[sessionName]); rec.Code != http.StatusNoContent {
		t.Fatalf("no login: %d", rec.Code)
	}

	// Malformed logins are dropped, the session still opens.
	for i, bad := range [][2]string{{"Al", "abcdefgh29"}, {"alice", "abcdefgh20"}, {"alice", ""}, {"", "abcdefgh29"}, {"al<ce", "abcdefgh29"}} {
		jti := strings.Repeat(string(rune('l'+i)), 32)
		c := redeemLogin(t, gate, loginTicket(now, jti, bad[0], bad[1]))
		if c[loginName] != nil || c[sessionName] == nil {
			t.Fatalf("login %q kept or session lost", bad)
		}
	}

	// Expired handoff.
	c = redeemLogin(t, gate, loginTicket(now, "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", "alice", "abcdefgh29"))
	gate.now = func() time.Time { return now.Add(loginTTL + time.Second) }
	if rec := gameLogin(gate, http.MethodPost, "", c[sessionName], c[loginName]); rec.Code != http.StatusNoContent {
		t.Fatalf("expired handoff: %d", rec.Code)
	}
	gate.now = func() time.Time { return now }

	// Another account's session cannot take it.
	c = redeemLogin(t, gate, loginTicket(now, "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr", "alice", "abcdefgh29"))
	other := &http.Cookie{Name: sessionName, Value: sign(gate.key, sessionLabel, sessionClaims{Sub: "99", Exp: now.Add(time.Hour).Unix()})}
	if rec := gameLogin(gate, http.MethodPost, "", other, c[loginName]); rec.Code != http.StatusNoContent {
		t.Fatalf("other account: %d", rec.Code)
	}
	if rec := gameLogin(gate, http.MethodPost, "", c[sessionName], c[loginName]); rec.Code != http.StatusNoContent {
		t.Fatalf("handoff survived a wrong-account attempt: %d", rec.Code)
	}
}

func slogTo(w io.Writer) *slog.Logger { return slog.New(slog.NewTextHandler(w, nil)) }

func TestGameLoginNeverLogged(t *testing.T) {
	_, gate := portalHarness(t)
	var logs strings.Builder
	gate.log = slogTo(&logs)
	now := time.Now()
	redeemLogin(t, gate, loginTicket(now, "ssssssssssssssssssssssssssssssss", "alice", "abcdefgh29"))
	redeemLogin(t, gate, loginTicket(now, "tttttttttttttttttttttttttttttttt", "alice", "abcdefgh20"))
	if !strings.Contains(logs.String(), "malformed login") {
		t.Fatalf("dropped login not reported: %s", logs.String())
	}
	if strings.Contains(logs.String(), "abcdefgh2") || strings.Contains(logs.String(), "alice") {
		t.Fatalf("login leaked to the log: %s", logs.String())
	}
}
