package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func valid() Config {
	c := Config{
		Listen:         "127.0.0.1:8290",
		AllowInsecure:  true,
		AllowedOrigins: []string{"http://127.0.0.1:8290"},
		Channels: []Channel{{
			Name: "local", Target: "127.0.0.1:8281",
			PublicWSURL: "ws://127.0.0.1:8290/ws/local", ClientVersion: 7640,
		}},
	}
	c.Defaults()
	return c
}

func TestValidate(t *testing.T) {
	if err := func() error { c := valid(); return c.Validate() }(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	cases := map[string]func(*Config){
		"insecure without opt-in": func(c *Config) { c.AllowInsecure = false; c.Channels[0].PublicWSURL = "wss://x/ws/local" },
		"ws url without opt-in":   func(c *Config) { c.AllowInsecure = false; c.TLSCert, c.TLSKey = "a", "b" },
		"wildcard origin":         func(c *Config) { c.AllowedOrigins = []string{"*"} },
		"origin with path":        func(c *Config) { c.AllowedOrigins = []string{"http://a/b"} },
		"no origins":              func(c *Config) { c.AllowedOrigins = nil },
		"no channels":             func(c *Config) { c.Channels = nil; c.DefaultChannel = "" },
		"bad channel name":        func(c *Config) { c.Channels[0].Name = "../x"; c.DefaultChannel = "" },
		"target without port":     func(c *Config) { c.Channels[0].Target = "127.0.0.1" },
		"target port zero":        func(c *Config) { c.Channels[0].Target = "127.0.0.1:0" },
		"missing client version":  func(c *Config) { c.Channels[0].ClientVersion = 0 },
		"ws url with query":       func(c *Config) { c.Channels[0].PublicWSURL = "ws://a/ws/local?host=b" },
		"unknown default channel": func(c *Config) { c.DefaultChannel = "other" },
		"message below one frame": func(c *Config) { c.Limits.MaxMessageBytes = 100 },
		"per-ip above total":      func(c *Config) { c.Limits.MaxConnsPerIP = c.Limits.MaxConns + 1 },
		"half tls":                func(c *Config) { c.TLSCert = "a" },
		"duplicate channel":       func(c *Config) { c.Channels = append(c.Channels, c.Channels[0]) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			c := valid()
			mutate(&c)
			if err := c.Validate(); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}

func TestLoadRejectsUnknownFields(t *testing.T) {
	p := filepath.Join(t.TempDir(), "g.json")
	body := `{"listen":"127.0.0.1:1","allowInsecure":true,"allowedOrigins":["http://a"],
	  "channels":[{"name":"a","target":"h:1","publicWsUrl":"ws://a/ws/a","clientVersion":1}],
	  "limits":{"idelTimeout":"1s"}}`
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(p); err == nil || !strings.Contains(err.Error(), "idelTimeout") {
		t.Fatalf("typo not reported: %v", err)
	}
}

func TestLoadExample(t *testing.T) {
	c, err := Load(filepath.Join("..", "..", "config.example.json"))
	if err != nil {
		t.Fatal(err)
	}
	if c.DefaultChannel != "local" || c.Limits.IdleTimeout.Std().Minutes() != 10 {
		t.Fatalf("unexpected example: %+v", c)
	}
}
