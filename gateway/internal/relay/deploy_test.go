package relay

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

func get(t *testing.T, url string, auth *config.BasicAuth) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if auth != nil {
		req.SetBasicAuth(auth.User, auth.Password)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBasicAuthGuardsEverythingButHealth(t *testing.T) {
	cred := &config.BasicAuth{User: "operator", Password: "correct-horse-battery"}
	site := t.TempDir()
	write(t, site, "client.html", "page")
	h := newHarness(t, func(c *config.Config) { c.BasicAuth = cred; c.StaticDir = site })

	if resp, body := get(t, h.srv.URL+"/healthz", nil); resp.StatusCode != http.StatusOK || body != "ok\n" {
		t.Fatalf("healthz: %d %q", resp.StatusCode, body)
	}
	for _, path := range []string{"/", "/client.html", "/config.json"} {
		resp, _ := get(t, h.srv.URL+path, nil)
		if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("WWW-Authenticate") == "" {
			t.Fatalf("%s without credential: %d", path, resp.StatusCode)
		}
		wrong := &config.BasicAuth{User: cred.User, Password: cred.Password + "x"}
		if resp, _ := get(t, h.srv.URL+path, wrong); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s with wrong password: %d", path, resp.StatusCode)
		}
	}
	if resp, body := get(t, h.srv.URL+"/client.html", cred); resp.StatusCode != http.StatusOK || body != "page" {
		t.Fatalf("authorized page: %d %q", resp.StatusCode, body)
	}
	// The WebSocket upgrade is behind the same guard.
	if _, resp, err := h.dial("/ws/local", testOrigin); err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated websocket was not refused: %v", err)
	}
}

func TestAssetDirFallback(t *testing.T) {
	site, assets := t.TempDir(), t.TempDir()
	write(t, site, "client.html", "page")
	write(t, site, "runtime.js", "image runtime")
	write(t, assets, "runtime.js", "volume must not shadow the image")
	write(t, assets, "openwyd_assets.data", "data")
	write(t, assets, "music/theme.mp3", "mp3")
	write(t, filepath.Dir(assets), "secret.txt", "outside")
	h := newHarness(t, func(c *config.Config) { c.StaticDir = site; c.AssetDir = assets })

	for path, want := range map[string]string{
		"/client.html": "page", "/runtime.js": "image runtime",
		"/openwyd_assets.data": "data", "/music/theme.mp3": "mp3",
	} {
		resp, body := get(t, h.srv.URL+path, nil)
		if resp.StatusCode != http.StatusOK || body != want {
			t.Fatalf("%s: %d %q", path, resp.StatusCode, body)
		}
	}
	for _, path := range []string{"/../secret.txt", "/music/", "/missing.data"} {
		if resp, _ := get(t, h.srv.URL+path, nil); resp.StatusCode == http.StatusOK {
			t.Fatalf("%s served", path)
		}
	}
	if resp, _ := get(t, h.srv.URL+"/openwyd_assets.data", nil); resp.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("data content type %q", resp.Header.Get("Content-Type"))
	}
}

func TestRemoteIPBehindProxy(t *testing.T) {
	r, _ := http.NewRequest(http.MethodGet, "/ws/local", nil)
	r.RemoteAddr = "10.0.0.7:5555"
	r.Header.Add("X-Forwarded-For", "6.6.6.6, 203.0.113.9")
	if got := remoteIP(r, ""); got != "10.0.0.7" {
		t.Fatalf("without proxy declaration: %s", got)
	}
	if got := remoteIP(r, "last"); got != "203.0.113.9" {
		t.Fatalf("behind proxy: %s", got)
	}
	// Railway: the edge replaces the client's header, so the client is first
	// and the later entries are edge hops.
	r.Header.Set("X-Forwarded-For", "198.51.100.4, 151.101.2.1")
	if got := remoteIP(r, "first"); got != "198.51.100.4" {
		t.Fatalf("first entry: %s", got)
	}
	r.Header.Del("X-Forwarded-For")
	r.Header.Add("X-Forwarded-For", "198.51.100.4")
	r.Header.Add("X-Forwarded-For", "151.101.2.1")
	if remoteIP(r, "first") != "198.51.100.4" || remoteIP(r, "last") != "151.101.2.1" {
		t.Fatal("repeated headers must read as one list")
	}
	r.Header.Set("X-Forwarded-For", "not-an-ip")
	if got := remoteIP(r, "first"); got != "10.0.0.7" {
		t.Fatalf("invalid header must fall back to the peer: %s", got)
	}
}

func TestAssetLoaderRevalidation(t *testing.T) {
	for _, inSite := range []bool{true, false} {
		site, assets := t.TempDir(), t.TempDir()
		dir := assets
		if inSite {
			dir = site
		}
		write(t, dir, "openwyd_assets.js", "loader with package hash")
		h := newHarness(t, func(c *config.Config) { c.StaticDir = site; c.AssetDir = assets })
		resp, _ := get(t, h.srv.URL+"/openwyd_assets.js", nil)
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("inSite=%v: %d %v", inSite, resp.StatusCode, resp.Header)
		}
		req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/openwyd_assets.js", nil)
		req.Header.Set("If-Modified-Since", resp.Header.Get("Last-Modified"))
		unchanged, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		unchanged.Body.Close()
		if unchanged.StatusCode != http.StatusNotModified || unchanged.Header.Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("revalidation inSite=%v: %d %v", inSite, unchanged.StatusCode, unchanged.Header)
		}
	}
}
