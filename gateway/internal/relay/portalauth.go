package relay

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

// Portal account gate (ADR 015). The portal, where accounts are created, signs
// a one-use ticket with a secret shared with the gateway and posts it to
// /auth/portal in a form body, never in a URL. The gateway answers with its own
// session cookie. Both tokens are base64url(JSON) "." base64url(HMAC-SHA256)
// over a distinct label plus the payload, so a cookie is never a valid ticket.
const (
	ticketLabel  = "wyd-play-ticket.v1."
	sessionLabel = "wyd-play-cookie.v1."
	sessionName  = "wyd_play"
	portalPath   = "/auth/portal"
	// The portal issues tickets for 60 s; the slack absorbs clock drift.
	ticketMaxLife = 2 * time.Minute
	clockSkew     = 30 * time.Second
	maxTokenBytes = 1024
	// maxSeenTickets bounds the replay cache; tickets expire within minutes.
	maxSeenTickets = 4096

	// Automatic game login (ADR 017). A ticket may carry the account's login
	// name and a one-time code issued by the game server; the gateway keeps
	// them in memory and hands them to the page once, through a POST that
	// needs both the session and a short-lived cookie scoped to that path.
	loginName = "wyd_login"
	loginPath = "/auth/game-login"
	// Codes are valid for two minutes on the server; nothing is kept longer.
	loginTTL     = 2 * time.Minute
	maxHandoffs  = 4096
	handoffIDLen = 16
)

// Same shapes as the game server (w2pp-OpenWYD internal/playcode and the
// account name rules); anything else is dropped and the player logs in by hand.
var (
	loginNameRe = regexp.MustCompile(`^[a-z0-9]{4,12}$`)
	loginCodeRe = regexp.MustCompile(`^[a-km-np-z2-9]{10}$`)
)

type ticketClaims struct {
	Sub  string `json:"sub"`
	Iat  int64  `json:"iat"`
	Exp  int64  `json:"exp"`
	Jti  string `json:"jti"`
	Name string `json:"name,omitempty"`
	Code string `json:"code,omitempty"`
}

// handoff is a game login waiting for its page.
type handoff struct {
	sub, name, code string
	exp             time.Time
}

type sessionClaims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

type portalGate struct {
	key    []byte
	login  string
	ttl    time.Duration
	secure bool
	xff    string
	next   http.Handler
	log    *slog.Logger
	now    func() time.Time

	mu       sync.Mutex
	seen     map[string]time.Time // ticket jti -> expiry
	handoffs map[string]handoff   // wyd_login cookie value -> login
}

func newPortalGate(cfg *config.Config, next http.Handler, log *slog.Logger) *portalGate {
	a := cfg.PortalAuth
	return &portalGate{
		key:   []byte(a.TicketSecret),
		login: strings.TrimSuffix(a.URL, "/") + "/jogar",
		ttl:   a.SessionTTL.Std(),
		// Plain HTTP only in local development; browsers drop Secure cookies there.
		secure:   !cfg.AllowInsecure,
		xff:      forwardedFor(cfg),
		next:     next,
		log:      log,
		now:      time.Now,
		seen:     map[string]time.Time{},
		handoffs: map[string]handoff{},
	}
}

func (p *portalGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == portalPath {
		p.handleTicket(w, r)
		return
	}
	if r.URL.Path == loginPath {
		p.handleGameLogin(w, r)
		return
	}
	if _, ok := p.session(r); ok {
		p.next.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	// A page navigation goes to the portal (login or sign-up, then back here);
	// assets, config.json and the WebSocket just fail.
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) &&
		(r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html")) {
		http.Redirect(w, r, p.login, http.StatusFound)
		return
	}
	http.Error(w, "authentication required", http.StatusUnauthorized)
}

func (p *portalGate) handleTicket(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4*maxTokenBytes)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	t, err := p.redeem(r.PostForm.Get("ticket"))
	if err != nil {
		// The reason is safe to log; the ticket itself never is.
		p.log.Warn("portal ticket rejected", "reason", err.Error(), "remote", remoteIP(r, p.xff))
		http.Error(w, "invalid or expired ticket; open the game again from the portal", http.StatusUnauthorized)
		return
	}
	exp := p.now().Add(p.ttl)
	if id := p.keepLogin(r, t); id != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     loginName,
			Value:    id,
			Path:     loginPath,
			MaxAge:   int(loginTTL / time.Second),
			HttpOnly: true,
			Secure:   p.secure,
			SameSite: http.SameSiteStrictMode,
		})
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionName,
		Value:    sign(p.key, sessionLabel, sessionClaims{Sub: t.Sub, Exp: exp.Unix()}),
		Path:     "/",
		MaxAge:   int(p.ttl / time.Second),
		HttpOnly: true,
		Secure:   p.secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// session returns the account of a valid gateway session cookie.
func (p *portalGate) session(r *http.Request) (string, bool) {
	c, err := r.Cookie(sessionName)
	if err != nil {
		return "", false
	}
	var s sessionClaims
	if verify(p.key, sessionLabel, c.Value, &s) != nil || s.Sub == "" || p.now().Unix() >= s.Exp {
		return "", false
	}
	return s.Sub, true
}

// keepLogin stores the ticket's game login, if any, and returns its handoff id.
// A malformed login is dropped: the player then types the password in the game.
func (p *portalGate) keepLogin(r *http.Request, t ticketClaims) string {
	if t.Name == "" && t.Code == "" {
		return ""
	}
	if !loginNameRe.MatchString(t.Name) || !loginCodeRe.MatchString(t.Code) {
		p.log.Warn("portal ticket login dropped", "reason", "malformed login", "remote", remoteIP(r, p.xff))
		return ""
	}
	b := make([]byte, handoffIDLen)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	id := hex.EncodeToString(b)
	now := p.now()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.handoffs) >= maxHandoffs {
		for k, h := range p.handoffs {
			if now.After(h.exp) {
				delete(p.handoffs, k)
			}
		}
		if len(p.handoffs) >= maxHandoffs {
			return ""
		}
	}
	p.handoffs[id] = handoff{sub: t.Sub, name: t.Name, code: t.Code, exp: now.Add(loginTTL)}
	return id
}

// handleGameLogin gives the page the pending game login once. It answers
// 204 when there is none, so the page falls back to the manual login.
func (p *portalGate) handleGameLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sub, ok := p.session(r)
	if !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	// Only the game page itself: the cookie is SameSite=Strict, and a browser
	// fetch always sends Origin on POST.
	if o := r.Header.Get("Origin"); o != "" {
		if u, err := url.Parse(o); err != nil || u.Host != r.Host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	c, err := r.Cookie(loginName)
	if err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: loginName, Value: "", Path: loginPath, MaxAge: -1,
		HttpOnly: true, Secure: p.secure, SameSite: http.SameSiteStrictMode})
	p.mu.Lock()
	h, found := p.handoffs[c.Value]
	delete(p.handoffs, c.Value)
	p.mu.Unlock()
	if !found || h.sub != sub || p.now().After(h.exp) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// The login is never logged; this response is its only copy outside memory.
	_ = json.NewEncoder(w).Encode(struct {
		Account string `json:"account"`
		Code    string `json:"code"`
	}{h.name, h.code})
}

// redeem validates a ticket and consumes its jti, returning its claims.
func (p *portalGate) redeem(token string) (ticketClaims, error) {
	var t ticketClaims
	if err := verify(p.key, ticketLabel, token, &t); err != nil {
		return ticketClaims{}, err
	}
	now := p.now()
	switch {
	case t.Sub == "" || len(t.Sub) > 64:
		return ticketClaims{}, errors.New("bad subject")
	case len(t.Jti) < 16 || len(t.Jti) > 64:
		return ticketClaims{}, errors.New("bad jti")
	case t.Exp <= t.Iat || time.Duration(t.Exp-t.Iat)*time.Second > ticketMaxLife:
		return ticketClaims{}, errors.New("bad lifetime")
	case now.Add(clockSkew).Unix() < t.Iat:
		return ticketClaims{}, errors.New("issued in the future")
	case now.Add(-clockSkew).Unix() >= t.Exp:
		return ticketClaims{}, errors.New("expired")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, used := p.seen[t.Jti]; used {
		return ticketClaims{}, errors.New("replayed")
	}
	if len(p.seen) >= maxSeenTickets {
		for id, exp := range p.seen {
			if now.Add(-clockSkew).After(exp) {
				delete(p.seen, id)
			}
		}
		if len(p.seen) >= maxSeenTickets {
			return ticketClaims{}, errors.New("replay cache full")
		}
	}
	p.seen[t.Jti] = time.Unix(t.Exp, 0)
	return t, nil
}

func mac(key []byte, label, payload string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(label))
	h.Write([]byte(payload))
	return h.Sum(nil)
}

func sign(key []byte, label string, v any) string {
	b, _ := json.Marshal(v)
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac(key, label, payload))
}

// verify checks the signature in constant time before decoding anything.
func verify(key []byte, label, token string, v any) error {
	if token == "" || len(token) > maxTokenBytes {
		return errors.New("missing or oversized token")
	}
	payload, sig, ok := strings.Cut(token, ".")
	if !ok || strings.Contains(sig, ".") {
		return errors.New("malformed token")
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, mac(key, label, payload)) {
		return errors.New("bad signature")
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || json.Unmarshal(b, v) != nil {
		return errors.New("malformed payload")
	}
	return nil
}
