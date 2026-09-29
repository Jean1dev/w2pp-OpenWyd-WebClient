package relay

import (
	"context"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

// s3Assets serves the operator's game data from a private S3-compatible bucket
// (e.g. a Railway bucket). The browser never sees the bucket or its
// credentials: the gateway signs a GET per request and streams the object
// back under the same origin, headers and authentication as the page.
type s3Assets struct {
	cfg    config.S3Assets
	base   *url.URL
	client *http.Client
	log    *slog.Logger
	now    func() time.Time
}

func newS3Assets(cfg config.S3Assets, dialTimeout time.Duration, log *slog.Logger) *s3Assets {
	base, _ := url.Parse(cfg.Endpoint) // validated by config
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.DialContext = (&net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}).DialContext
	tr.ResponseHeaderTimeout = 30 * time.Second
	tr.MaxIdleConnsPerHost = 16
	return &s3Assets{cfg: cfg, base: base, log: log, now: time.Now,
		client: &http.Client{Transport: tr, Timeout: 0, // bodies of ~300 MB stream for minutes
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// objectURL maps a site path to the bucket object under the configured prefix.
func (s *s3Assets) objectURL(sitePath string) (*url.URL, bool) {
	key := strings.TrimPrefix(path.Clean("/"+sitePath), "/")
	if key == "" || key == "." || strings.HasPrefix(key, "..") {
		return nil, false
	}
	key = strings.Trim(s.cfg.Prefix, "/") + "/" + key
	key = strings.TrimPrefix(key, "/")
	u := *s.base
	if s.cfg.URLStyle == "path" {
		u.Path = "/" + s.cfg.Bucket + "/" + key
	} else {
		u.Host = s.cfg.Bucket + "." + s.base.Host
		u.Path = "/" + key
	}
	u.RawPath = "" // let url.URL escape each segment (RFC 3986, '/' kept)
	return &u, true
}

// Headers forwarded from the browser (unsigned except Range) and back.
var (
	s3ForwardRequest  = []string{"Range", "If-None-Match", "If-Modified-Since"}
	s3ForwardResponse = []string{"Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"}
)

func (s *s3Assets) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	u, ok := s.objectURL(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, r.Method, u.String(), nil)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	for _, h := range s3ForwardRequest {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	signV4(req, s.cfg.AccessKeyID, s.cfg.SecretAccessKey, s.cfg.Region, s.now())
	resp, err := s.client.Do(req)
	if err != nil {
		s.log.Warn("asset storage unreachable", "path", r.URL.Path, "err", err)
		http.Error(w, "asset storage unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden:
		// A missing key and a key outside the credential's reach look the same.
		http.NotFound(w, r)
		return
	case resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent &&
		resp.StatusCode != http.StatusNotModified && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable:
		s.log.Warn("asset storage error", "path", r.URL.Path, "status", resp.StatusCode)
		http.Error(w, "asset storage error", http.StatusBadGateway)
		return
	}
	for _, h := range s3ForwardResponse {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	// The type comes from the name, as for the image's files (static.go init).
	if ct := mime.TypeByExtension(path.Ext(r.URL.Path)); ct != "" {
		w.Header().Set("Content-Type", ct)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, resp.Body)
	}
}
