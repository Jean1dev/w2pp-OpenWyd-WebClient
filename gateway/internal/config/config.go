// Package config loads and validates the operator-owned gateway configuration.
//
// Every TCP destination the gateway can reach is named here. The browser only
// ever picks a channel name; it never supplies a host or port.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Duration is a time.Duration that unmarshals from a Go duration string ("30s").
type Duration time.Duration

// UnmarshalJSON accepts only duration strings, so a bare number cannot be
// misread as nanoseconds.
func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("duration must be a string like \"30s\": %w", err)
	}
	v, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("parse duration %q: %w", s, err)
	}
	*d = Duration(v)
	return nil
}

// Std returns the value as a time.Duration.
func (d Duration) Std() time.Duration { return time.Duration(d) }

// Channel maps a public name to a private TCP destination.
type Channel struct {
	// Name is the only identifier the browser sends (path /ws/<name>).
	Name string `json:"name"`
	// Target is the tmserver host:port. It is never exposed to the browser.
	Target string `json:"target"`
	// PublicWSURL is the ws(s):// URL the browser must open for this channel.
	PublicWSURL string `json:"publicWsUrl"`
	// ClientVersion is the AccountLogin version the target tmserver expects
	// (its -client-version / W2PP_CLIENT_VERSION). It is not the 7662 build number.
	ClientVersion int `json:"clientVersion"`
}

// Limits bound memory, connection count and time spent per connection.
type Limits struct {
	MaxConns      int `json:"maxConns"`
	MaxConnsPerIP int `json:"maxConnsPerIP"`
	// MaxMessageBytes caps a single WebSocket message from the browser.
	MaxMessageBytes int64 `json:"maxMessageBytes"`
	// BufferBytes is the fixed copy buffer per direction; there is no other queue.
	BufferBytes  int      `json:"bufferBytes"`
	IdleTimeout  Duration `json:"idleTimeout"`
	DialTimeout  Duration `json:"dialTimeout"`
	WriteTimeout Duration `json:"writeTimeout"`
}

// Config is the full gateway configuration.
type Config struct {
	Listen string `json:"listen"`
	// TLSCert/TLSKey enable HTTPS/WSS. Without them AllowInsecure must be set.
	TLSCert string `json:"tlsCert"`
	TLSKey  string `json:"tlsKey"`
	// AllowInsecure explicitly permits plain HTTP/WS, intended for local development.
	AllowInsecure bool `json:"allowInsecure"`
	// TLSTerminatedByProxy declares that a platform edge (e.g. Railway) serves
	// HTTPS/WSS and forwards plain HTTP to Listen. The public side must then be
	// wss:// and https:// only; nothing is served insecurely to the browser.
	TLSTerminatedByProxy bool `json:"tlsTerminatedByProxy"`
	// AllowedOrigins are exact scheme://host[:port] browser origins.
	AllowedOrigins []string `json:"allowedOrigins"`
	// StaticDir optionally serves the built client from the same origin.
	StaticDir string `json:"staticDir"`
	// AssetDir is a second read-only root for files absent from StaticDir: the
	// operator's local game data (never part of the image or the repository).
	AssetDir string `json:"assetDir"`
	// AssetS3 is the alternative to AssetDir: a private S3-compatible bucket
	// (e.g. Railway) the gateway reads with SigV4 and streams to the browser.
	AssetS3 *S3Assets `json:"assetS3"`
	// BasicAuth, when set, protects every route except /healthz. The password
	// comes from the operator's environment, never from a committed file.
	BasicAuth *BasicAuth `json:"basicAuth"`
	// PortalAuth, the alternative to BasicAuth, admits whoever holds an account
	// on the operator's portal: the portal posts a short-lived signed ticket and
	// the gateway answers with its own session cookie.
	PortalAuth           *PortalAuth `json:"portalAuth"`
	AssetManifestVersion string      `json:"assetManifestVersion"`
	DefaultChannel       string      `json:"defaultChannel"`
	Channels             []Channel   `json:"channels"`
	Limits               Limits      `json:"limits"`
}

// BasicAuth is a single operator-issued credential for a private deployment.
type BasicAuth struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

// PortalAuth trusts tickets signed by the portal with a shared secret. The
// secret comes from the operator's environment, never from a committed file.
type PortalAuth struct {
	// URL is the portal origin; visitors without a session go to URL + "/jogar".
	URL          string `json:"url"`
	TicketSecret string `json:"ticketSecret"`
	// SessionTTL is the lifetime of the gateway's own session cookie.
	SessionTTL Duration `json:"sessionTtl"`
}

// S3Assets locates the game data in a private bucket. Keys are
// Prefix + site path. Credentials come from the operator's environment.
type S3Assets struct {
	Endpoint        string `json:"endpoint"` // https://host of the S3 API
	Region          string `json:"region"`   // SigV4 region ("auto" on Railway)
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix"`   // e.g. "assets-f4c03289374bd614"
	URLStyle        string `json:"urlStyle"` // "virtual-host" (default) or "path"
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// MinPasswordLen rejects trivially guessable deployment passwords.
const MinPasswordLen = 12

// MinTicketSecretLen is the HMAC-SHA256 key size shared with the portal.
const MinTicketSecretLen = 32

var channelName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// Defaults fills unset limits with conservative values.
func (c *Config) Defaults() {
	l := &c.Limits
	if l.MaxConns == 0 {
		l.MaxConns = 256
	}
	if l.MaxConnsPerIP == 0 {
		l.MaxConnsPerIP = 4
	}
	if l.MaxMessageBytes == 0 {
		// CPSock frames are at most 8192 bytes, but the client may coalesce
		// several queued frames into one send.
		l.MaxMessageBytes = 64 << 10
	}
	if l.BufferBytes == 0 {
		l.BufferBytes = 16 << 10
	}
	if l.IdleTimeout == 0 {
		l.IdleTimeout = Duration(10 * time.Minute)
	}
	if l.DialTimeout == 0 {
		l.DialTimeout = Duration(10 * time.Second)
	}
	if l.WriteTimeout == 0 {
		l.WriteTimeout = Duration(15 * time.Second)
	}
	if c.PortalAuth != nil && c.PortalAuth.SessionTTL == 0 {
		c.PortalAuth.SessionTTL = Duration(12 * time.Hour)
	}
	if c.DefaultChannel == "" && len(c.Channels) == 1 {
		c.DefaultChannel = c.Channels[0].Name
	}
}

// Validate rejects configurations that would open an ambiguous or unsafe relay.
func (c *Config) Validate() error {
	var errs []error
	if _, _, err := net.SplitHostPort(c.Listen); err != nil {
		errs = append(errs, fmt.Errorf("listen %q: %w", c.Listen, err))
	}
	tls := c.TLSCert != "" || c.TLSKey != ""
	if tls && (c.TLSCert == "" || c.TLSKey == "") {
		errs = append(errs, errors.New("tlsCert and tlsKey must be set together"))
	}
	if !tls && !c.AllowInsecure && !c.TLSTerminatedByProxy {
		errs = append(errs, errors.New("no TLS configured: set tlsCert/tlsKey, tlsTerminatedByProxy, or allowInsecure for local development"))
	}
	if c.TLSTerminatedByProxy && c.AllowInsecure {
		errs = append(errs, errors.New("tlsTerminatedByProxy and allowInsecure are exclusive"))
	}
	if c.TLSTerminatedByProxy {
		for _, o := range c.AllowedOrigins {
			if !strings.HasPrefix(o, "https://") {
				errs = append(errs, fmt.Errorf("allowedOrigins: %q must be https:// behind a TLS proxy", o))
			}
		}
	}
	if a := c.BasicAuth; a != nil {
		if a.User == "" || strings.Contains(a.User, ":") {
			errs = append(errs, errors.New("basicAuth.user must be non-empty and contain no ':'"))
		}
		if len(a.Password) < MinPasswordLen {
			errs = append(errs, fmt.Errorf("basicAuth.password must have at least %d characters", MinPasswordLen))
		}
	}
	if a := c.PortalAuth; a != nil {
		if c.BasicAuth != nil {
			errs = append(errs, errors.New("basicAuth and portalAuth are exclusive"))
		}
		u, err := url.Parse(a.URL)
		switch {
		case err != nil || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil:
			errs = append(errs, errors.New("portalAuth.url must be a bare scheme://host URL"))
		case u.Scheme != "https" && !(u.Scheme == "http" && c.AllowInsecure):
			errs = append(errs, errors.New("portalAuth.url must be https:// (http only with allowInsecure)"))
		}
		if len(a.TicketSecret) < MinTicketSecretLen {
			errs = append(errs, fmt.Errorf("portalAuth.ticketSecret must have at least %d characters", MinTicketSecretLen))
		}
		if ttl := a.SessionTTL.Std(); ttl < time.Minute || ttl > 7*24*time.Hour {
			errs = append(errs, errors.New("portalAuth.sessionTtl must be between 1m and 168h"))
		}
	}
	if c.AssetDir != "" && c.StaticDir == "" {
		errs = append(errs, errors.New("assetDir requires staticDir"))
	}
	if a := c.AssetS3; a != nil {
		if c.AssetDir != "" {
			errs = append(errs, errors.New("assetDir and assetS3 are exclusive"))
		}
		if c.StaticDir == "" {
			errs = append(errs, errors.New("assetS3 requires staticDir"))
		}
		u, err := url.Parse(a.Endpoint)
		switch {
		case err != nil || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil:
			errs = append(errs, errors.New("assetS3.endpoint must be a bare scheme://host URL"))
		case u.Scheme != "https" && !(u.Scheme == "http" && c.AllowInsecure):
			errs = append(errs, errors.New("assetS3.endpoint must be https:// (http only with allowInsecure)"))
		}
		if !bucketName.MatchString(a.Bucket) {
			errs = append(errs, errors.New("assetS3.bucket is not a valid bucket name"))
		}
		if a.Region == "" || a.AccessKeyID == "" || a.SecretAccessKey == "" {
			errs = append(errs, errors.New("assetS3 needs region, accessKeyId and secretAccessKey"))
		}
		if a.URLStyle != "" && a.URLStyle != "virtual-host" && a.URLStyle != "path" {
			errs = append(errs, errors.New("assetS3.urlStyle must be virtual-host or path"))
		}
		if strings.Contains(a.Prefix, "..") {
			errs = append(errs, errors.New("assetS3.prefix must not contain '..'"))
		}
	}
	if len(c.AllowedOrigins) == 0 {
		errs = append(errs, errors.New("allowedOrigins is empty"))
	}
	for _, o := range c.AllowedOrigins {
		if err := validateOrigin(o); err != nil {
			errs = append(errs, err)
		}
	}
	if len(c.Channels) == 0 {
		errs = append(errs, errors.New("no channels configured"))
	}
	seen := map[string]bool{}
	for i, ch := range c.Channels {
		if !channelName.MatchString(ch.Name) {
			errs = append(errs, fmt.Errorf("channels[%d]: invalid name %q", i, ch.Name))
		}
		if seen[ch.Name] {
			errs = append(errs, fmt.Errorf("channels[%d]: duplicate name %q", i, ch.Name))
		}
		seen[ch.Name] = true
		if err := validateTarget(ch.Target); err != nil {
			errs = append(errs, fmt.Errorf("channels[%d] target: %w", i, err))
		}
		if ch.ClientVersion <= 0 {
			errs = append(errs, fmt.Errorf("channels[%d]: clientVersion must be positive", i))
		}
		if u, err := url.Parse(ch.PublicWSURL); err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.RawQuery != "" {
			errs = append(errs, fmt.Errorf("channels[%d]: publicWsUrl must be a ws:// or wss:// URL without query", i))
		} else if u.Scheme == "ws" && !c.AllowInsecure {
			errs = append(errs, fmt.Errorf("channels[%d]: ws:// requires allowInsecure", i))
		}
	}
	if c.DefaultChannel != "" && !seen[c.DefaultChannel] {
		errs = append(errs, fmt.Errorf("defaultChannel %q is not configured", c.DefaultChannel))
	}
	l := c.Limits
	if l.MaxConns <= 0 || l.MaxConnsPerIP <= 0 || l.MaxConnsPerIP > l.MaxConns {
		errs = append(errs, errors.New("limits: need 0 < maxConnsPerIP <= maxConns"))
	}
	if l.MaxMessageBytes < 8192 {
		errs = append(errs, errors.New("limits.maxMessageBytes must hold one 8192-byte CPSock frame"))
	}
	if l.BufferBytes < 512 || l.BufferBytes > 1<<20 {
		errs = append(errs, errors.New("limits.bufferBytes must be between 512 and 1MiB"))
	}
	if l.IdleTimeout <= 0 || l.DialTimeout <= 0 || l.WriteTimeout <= 0 {
		errs = append(errs, errors.New("limits: timeouts must be positive"))
	}
	return errors.Join(errs...)
}

// Channel returns the configured channel with that name.
func (c *Config) Channel(name string) (Channel, bool) {
	for _, ch := range c.Channels {
		if ch.Name == name {
			return ch, true
		}
	}
	return Channel{}, false
}

func validateOrigin(o string) error {
	u, err := url.Parse(o)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil || strings.Contains(o, "*") {
		return fmt.Errorf("allowedOrigins: %q must be an exact http(s)://host[:port] origin", o)
	}
	return nil
}

func validateTarget(t string) error {
	host, port, err := net.SplitHostPort(t)
	if err != nil {
		return err
	}
	if host == "" {
		return fmt.Errorf("%q has no host", t)
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return fmt.Errorf("%q has invalid port", t)
	}
	return nil
}

// Load reads, defaults and validates a JSON configuration file. Unknown fields
// are rejected so a typo cannot silently disable a limit.
func Load(path string) (*Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open config: %w", err)
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("decode config %s: %w", path, err)
	}
	c.Defaults()
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config %s: %w", path, err)
	}
	return &c, nil
}
