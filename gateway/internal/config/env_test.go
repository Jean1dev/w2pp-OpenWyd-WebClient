package config

import (
	"strings"
	"testing"
	"time"
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

func TestFromEnvPortalGate(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	portal := map[string]string{EnvAuthUser: "", EnvAuthPassword: "",
		EnvPortalURL: "https://wyd-ten.vercel.app/", EnvPortalSecret: secret}
	c, err := FromEnv(env(portal))
	if err != nil {
		t.Fatal(err)
	}
	if c.BasicAuth != nil || c.PortalAuth == nil || c.PortalAuth.URL != "https://wyd-ten.vercel.app" ||
		c.PortalAuth.SessionTTL.Std() != 12*time.Hour {
		t.Fatalf("unexpected portal config %+v", c.PortalAuth)
	}
	bad := map[string]map[string]string{
		"with basic":     {EnvAuthUser: "operator", EnvAuthPassword: "correct-horse-battery"},
		"short secret":   {EnvPortalSecret: secret[:31]},
		"no secret":      {EnvPortalSecret: ""},
		"no url":         {EnvPortalURL: ""},
		"http url":       {EnvPortalURL: "http://wyd-ten.vercel.app"},
		"url with path":  {EnvPortalURL: "https://wyd-ten.vercel.app/jogar"},
		"url with query": {EnvPortalURL: "https://wyd-ten.vercel.app?x=1"},
	}
	for name, over := range bad {
		t.Run(name, func(t *testing.T) {
			e := map[string]string{}
			for k, v := range portal {
				e[k] = v
			}
			for k, v := range over {
				e[k] = v
			}
			_, err := FromEnv(env(e))
			if err == nil {
				t.Fatal("accepted")
			}
			if strings.Contains(err.Error(), secret[:16]) {
				t.Fatal("error message leaks the secret")
			}
		})
	}
}

func TestFromEnvForwardedFor(t *testing.T) {
	c, err := FromEnv(env(map[string]string{EnvForwardedFor: "first"}))
	if err != nil || c.ForwardedFor != "first" {
		t.Fatalf("first refused: %v", err)
	}
	if _, err := FromEnv(env(map[string]string{EnvForwardedFor: "middle"})); err == nil {
		t.Fatal("invalid position accepted")
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

func TestFromEnvBucket(t *testing.T) {
	c, err := FromEnv(env(map[string]string{EnvS3Endpoint: "https://t3.storageapi.dev/", EnvS3Bucket: "arranged-orb-x1",
		EnvS3Prefix: "assets-v1", EnvS3KeyID: "id", EnvS3Secret: "s3-secret-value"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.AssetDir != "" || c.AssetS3 == nil || c.AssetS3.Region != "auto" || c.AssetS3.Endpoint != "https://t3.storageapi.dev" {
		t.Fatalf("bucket config %+v", c.AssetS3)
	}
	for name, over := range map[string]map[string]string{
		"http endpoint": {EnvS3Endpoint: "http://t3.storageapi.dev"},
		"no secret":     {EnvS3Secret: ""},
		"bad bucket":    {EnvS3Bucket: "Bad_Bucket"},
		"bad style":     {EnvS3URLStyle: "dns"},
		"traversal":     {EnvS3Prefix: "../x"},
	} {
		base := map[string]string{EnvS3Endpoint: "https://t3.storageapi.dev", EnvS3Bucket: "arranged-orb-x1",
			EnvS3KeyID: "id", EnvS3Secret: "s3-secret-value"}
		for k, v := range over {
			base[k] = v
		}
		_, err := FromEnv(env(base))
		if err == nil {
			t.Fatalf("%s accepted", name)
		}
		if strings.Contains(err.Error(), "s3-secret-value") {
			t.Fatalf("%s: error leaks the secret", name)
		}
	}
}
