package relay

import (
	"crypto/sha256"
	"crypto/subtle"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

func init() {
	// Windows registries may map .wasm/.data to nothing or to text/plain;
	// streaming WASM compilation requires application/wasm.
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".data", "application/octet-stream")
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".mjs", "text/javascript; charset=utf-8")
}

// staticHandler serves the built client from dir and, for paths absent there,
// the operator's game data from assets (a volume directory or a bucket;
// optional). Directory listings are disabled and HTML is never cached so a
// rebuilt page is picked up immediately.
func staticHandler(dir string, assets http.Handler) http.Handler {
	site := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-store")
		}
		// The loader carries the package's content hash. Revalidate even when
		// it lives in the site directory, so IndexedDB sees asset updates.
		if r.URL.Path == "/openwyd_assets.js" {
			w.Header().Set("Cache-Control", "private, no-cache")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if assets != nil && r.URL.Path != "/" && !exists(dir, r.URL.Path) {
			// Same origin, same headers; the data is revalidated, not pinned.
			if w.Header().Get("Cache-Control") == "" {
				w.Header().Set("Cache-Control", "no-cache")
			}
			assets.ServeHTTP(w, r)
			return
		}
		site.ServeHTTP(w, r)
	})
}

// exists reports whether a regular file for the URL path is present in dir,
// using http.Dir's own cleaning (no traversal outside dir).
func exists(dir, urlPath string) bool {
	f, err := http.Dir(dir).Open(path.Clean("/" + urlPath))
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	return err == nil && !st.IsDir()
}

// basicAuth guards next with one credential, compared in constant time on
// SHA-256 digests so neither length nor prefix leaks through timing.
func basicAuth(a config.BasicAuth, next http.Handler) http.Handler {
	wantUser := sha256.Sum256([]byte(a.User))
	wantPass := sha256.Sum256([]byte(a.Password))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		gotUser := sha256.Sum256([]byte(user))
		gotPass := sha256.Sum256([]byte(pass))
		userOK := subtle.ConstantTimeCompare(gotUser[:], wantUser[:]) == 1
		passOK := subtle.ConstantTimeCompare(gotPass[:], wantPass[:]) == 1
		if !ok || !userOK || !passOK {
			w.Header().Set("WWW-Authenticate", `Basic realm="wyd", charset="UTF-8"`)
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
