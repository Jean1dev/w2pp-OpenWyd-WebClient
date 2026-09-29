package config

import (
	"strings"
	"testing"
)

func env(over map[string]string) func(string) string {
	base := map[string]string{
		EnvPort: "8080", EnvPublicOrigin: "https://wyd.example.app/", EnvTarget: "tm-server.railway.internal:8281",
		EnvClientVersion: "12000", EnvStaticDir: "/srv/site", EnvAssetDir: "/data/assets",
		EnvAuthUser: "operator", EnvAuthPassword: "correct-horse-battery",
	}
	for k, v := range over {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

func TestFromEnv(t *testing.T) {
	c, err := FromEnv(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	ch := c.Channels[0]
	if c.Listen != "0.0.0.0:8080" || !c.TLSTerminatedByProxy || c.AllowInsecure ||
		c.AllowedOrigins[0] != "https://wyd.example.app" || ch.Name != "server" ||
		ch.PublicWSURL != "wss://wyd.example.app/ws/server" || ch.Target != "tm-server.railway.internal:8281" ||
		ch.ClientVersion != 12000 || c.AssetDir != "/data/assets" || c.BasicAuth == nil {
		t.Fatalf("unexpected config %+v", c)
	}
}

func TestFromEnvRejects(t *testing.T) {
	cases := map[string]map[string]string{
		"missing target":        {EnvTarget: ""},
		"missing port":          {EnvPort: ""},
		"http origin":           {EnvPublicOrigin: "http://wyd.example.app"},
		"bad version":           {EnvClientVersion: "12k"},
		"no credential":         {EnvAuthUser: "", EnvAuthPassword: ""},
		"short password":        {EnvAuthPassword: "short"},
		"user with colon":       {EnvAuthUser: "a:b"},
		"password without user": {EnvAuthUser: ""},
		"bad limit":             {EnvMaxConns: "-1"},
	}
	for name, over := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := FromEnv(env(over))
			if err == nil {
				t.Fatal("accepted")
			}
			if strings.Contains(err.Error(), "correct-horse-battery") {
				t.Fatal("error message leaks the password")
			}
		})
	}
}

func TestFromEnvPublicNeedsExplicitOptIn(t *testing.T) {
	c, err := FromEnv(env(map[string]string{EnvAuthUser: "", EnvAuthPassword: "", EnvAllowPublic: "true"}))
	if err != nil || c.BasicAuth != nil {
		t.Fatalf("explicit public deployment refused: %v", err)
	}
}

func TestTLSProxyValidation(t *testing.T) {
	c := valid()
	c.AllowInsecure = false
	c.TLSTerminatedByProxy = true
	c.AllowedOrigins = []string{"https://a.example"}
	c.Channels[0].PublicWSURL = "wss://a.example/ws/local"
	if err := c.Validate(); err != nil {
		t.Fatalf("valid proxy config rejected: %v", err)
	}
	bad := map[string]func(*Config){
		"ws url":          func(c *Config) { c.Channels[0].PublicWSURL = "ws://a.example/ws/local" },
		"http origin":     func(c *Config) { c.AllowedOrigins = []string{"http://a.example"} },
		"also insecure":   func(c *Config) { c.AllowInsecure = true },
		"assets w/o site": func(c *Config) { c.AssetDir = "/data" },
	}
	for name, mut := range bad {
		t.Run(name, func(t *testing.T) {
			d := c
			d.AllowedOrigins = append([]string(nil), c.AllowedOrigins...)
			d.Channels = append([]Channel(nil), c.Channels...)
			mut(&d)
			if d.Validate() == nil {
				t.Fatal("accepted")
			}
		})
	}
}
