package relay

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
)

// AWS SigV4 documentation, S3 "GET Object" example (examplebucket, Range).
func TestSignV4AWSVector(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	now := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
	signV4(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", now)
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("authorization\n got %s\nwant %s", got, want)
	}
}

func TestS3ObjectURL(t *testing.T) {
	s := newS3Assets(config.S3Assets{Endpoint: "https://t3.example.dev", Bucket: "b-1", Prefix: "/assets-v1/",
		Region: "auto", AccessKeyID: "k", SecretAccessKey: "s"}, time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
	u, ok := s.objectURL("/music/Theme 1.mp3")
	if !ok || u.String() != "https://b-1.t3.example.dev/assets-v1/music/Theme%201.mp3" {
		t.Fatalf("virtual-host url %v %v", u, ok)
	}
	s.cfg.URLStyle = "path"
	if u, _ := s.objectURL("/openwyd_assets.data"); u.String() != "https://t3.example.dev/b-1/assets-v1/openwyd_assets.data" {
		t.Fatalf("path url %v", u)
	}
	for _, p := range []string{"/", "/../x", ""} {
		if u, ok := s.objectURL(p); ok && !strings.HasPrefix(u.Path, "/b-1/assets-v1/") {
			t.Fatalf("%q escaped the prefix: %v", p, u)
		}
	}
}

func TestS3AssetsStreamThroughGateway(t *testing.T) {
	var seen []*http.Request
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=key-id/") ||
			r.Header.Get("X-Amz-Content-Sha256") != emptyPayloadHash {
			http.Error(w, "unsigned", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/bucket-x/v1/openwyd_assets.data":
			w.Header().Set("ETag", `"abc"`)
			w.Header().Set("Content-Type", "binary/octet-stream")
			if r.Header.Get("Range") == "bytes=0-3" {
				w.Header().Set("Content-Range", "bytes 0-3/10")
				w.WriteHeader(http.StatusPartialContent)
				io.WriteString(w, "0123")
				return
			}
			io.WriteString(w, "0123456789")
		case "/bucket-x/v1/boom.data":
			http.Error(w, "internal", http.StatusInternalServerError)
		default:
			http.Error(w, "NoSuchKey", http.StatusNotFound)
		}
	}))
	defer fake.Close()
	site := t.TempDir()
	write(t, site, "runtime.js", "image runtime")
	cred := &config.BasicAuth{User: "operator", Password: "correct-horse-battery"}
	h := newHarness(t, func(c *config.Config) {
		c.StaticDir = site
		c.BasicAuth = cred
		c.AssetS3 = &config.S3Assets{Endpoint: fake.URL, Region: "auto", Bucket: "bucket-x", Prefix: "v1",
			URLStyle: "path", AccessKeyID: "key-id", SecretAccessKey: "secret-value"}
	})

	resp, body := get(t, h.srv.URL+"/openwyd_assets.data", cred)
	if resp.StatusCode != http.StatusOK || body != "0123456789" ||
		resp.Header.Get("Content-Type") != "application/octet-stream" || resp.Header.Get("ETag") != `"abc"` {
		t.Fatalf("object: %d %q %v", resp.StatusCode, body, resp.Header)
	}
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/openwyd_assets.data", nil)
	req.SetBasicAuth(cred.User, cred.Password)
	req.Header.Set("Range", "bytes=0-3")
	r2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b2, _ := io.ReadAll(r2.Body)
	r2.Body.Close()
	if r2.StatusCode != http.StatusPartialContent || string(b2) != "0123" || r2.Header.Get("Content-Range") != "bytes 0-3/10" {
		t.Fatalf("range: %d %q", r2.StatusCode, b2)
	}
	if resp, body := get(t, h.srv.URL+"/runtime.js", cred); body != "image runtime" || resp.StatusCode != 200 {
		t.Fatal("the bucket must not shadow the image")
	}
	if resp, _ := get(t, h.srv.URL+"/missing.data", cred); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing: %d", resp.StatusCode)
	}
	if resp, _ := get(t, h.srv.URL+"/boom.data", cred); resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("storage error: %d", resp.StatusCode)
	}
	n := len(seen)
	if resp, _ := get(t, h.srv.URL+"/openwyd_assets.data", nil); resp.StatusCode != http.StatusUnauthorized || len(seen) != n {
		t.Fatal("unauthenticated request reached the bucket")
	}
	for _, r := range seen {
		if strings.Contains(r.URL.String(), "secret-value") || strings.Contains(r.Header.Get("Authorization"), "secret-value") {
			t.Fatal("secret sent to storage")
		}
	}
}
