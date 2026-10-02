package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
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
)

type ticketClaims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
	Jti string `json:"jti"`
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
	proxy  bool
	next   http.Handler
	log    *slog.Logger
	now    func() time.Time

	mu   sync.Mutex
	seen map[string]time.Time // ticket jti -> expiry
}

func newPortalGate(cfg *config.Config, next http.Handler, log *slog.Logger) *portalGate {
	a := cfg.PortalAuth
	return &portalGate{
		key:   []byte(a.TicketSecret),
		login: strings.TrimSuffix(a.URL, "/") + "/jogar",
		ttl:   a.SessionTTL.Std(),
		// Plain HTTP only in local development; browsers drop Secure cookies there.
		secure: !cfg.AllowInsecure,
		proxy:  cfg.TLSTerminatedByProxy,
		next:   next,
		log:    log,
		now:    time.Now,
		seen:   map[string]time.Time{},
	}
}

func (p *portalGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == portalPath {
		p.handleTicket(w, r)
		return
	}
	if c, err := r.Cookie(sessionName); err == nil {
		var s sessionClaims
		if verify(p.key, sessionLabel, c.Value, &s) == nil && s.Sub != "" && p.now().Unix() < s.Exp {
			p.next.ServeHTTP(w, r)
			return
		}
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
	sub, err := p.redeem(r.PostForm.Get("ticket"))
	if err != nil {
		// The reason is safe to log; the ticket itself never is.
		p.log.Warn("portal ticket rejected", "reason", err.Error(), "remote", remoteIP(r, p.proxy))
		http.Error(w, "invalid or expired ticket; open the game again from the portal", http.StatusUnauthorized)
		return
	}
	exp := p.now().Add(p.ttl)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionName,
		Value:    sign(p.key, sessionLabel, sessionClaims{Sub: sub, Exp: exp.Unix()}),
		Path:     "/",
		MaxAge:   int(p.ttl / time.Second),
		HttpOnly: true,
		Secure:   p.secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// redeem validates a ticket and consumes its jti, returning the account id.
func (p *portalGate) redeem(token string) (string, error) {
	var t ticketClaims
	if err := verify(p.key, ticketLabel, token, &t); err != nil {
		return "", err
	}
	now := p.now()
	switch {
	case t.Sub == "" || len(t.Sub) > 64:
		return "", errors.New("bad subject")
	case len(t.Jti) < 16 || len(t.Jti) > 64:
		return "", errors.New("bad jti")
	case t.Exp <= t.Iat || time.Duration(t.Exp-t.Iat)*time.Second > ticketMaxLife:
		return "", errors.New("bad lifetime")
	case now.Add(clockSkew).Unix() < t.Iat:
		return "", errors.New("issued in the future")
	case now.Add(-clockSkew).Unix() >= t.Exp:
		return "", errors.New("expired")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, used := p.seen[t.Jti]; used {
		return "", errors.New("replayed")
	}
	if len(p.seen) >= maxSeenTickets {
		for id, exp := range p.seen {
			if now.Add(-clockSkew).After(exp) {
				delete(p.seen, id)
			}
		}
		if len(p.seen) >= maxSeenTickets {
			return "", errors.New("replay cache full")
		}
	}
	p.seen[t.Jti] = time.Unix(t.Exp, 0)
	return t.Sub, nil
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
