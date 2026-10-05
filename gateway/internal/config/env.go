package config

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Environment variables read by FromEnv (container deployments such as
// Railway). Secrets stay in the platform's variables, never in the image.
const (
	EnvPort          = "PORT"               // listen port given by the platform
	EnvPublicOrigin  = "WYD_PUBLIC_ORIGIN"  // https://host the browser uses
	EnvTarget        = "WYD_TARGET"         // tmserver host:port (private network)
	EnvClientVersion = "WYD_CLIENT_VERSION" // AccountLogin version of the target
	EnvChannel       = "WYD_CHANNEL"        // public channel name (default "server")
	EnvStaticDir     = "WYD_STATIC_DIR"     // built page + runtime (in the image)
	EnvAssetDir      = "WYD_ASSET_DIR"      // operator game data (mounted volume)
	// Operator game data in a private S3-compatible bucket (exclusive with WYD_ASSET_DIR).
	EnvS3Endpoint    = "WYD_ASSET_S3_ENDPOINT"
	EnvS3Region      = "WYD_ASSET_S3_REGION"
	EnvS3Bucket      = "WYD_ASSET_S3_BUCKET"
	EnvS3Prefix      = "WYD_ASSET_S3_PREFIX"
	EnvS3URLStyle    = "WYD_ASSET_S3_URL_STYLE"
	EnvS3KeyID       = "WYD_ASSET_S3_ACCESS_KEY_ID"
	EnvS3Secret      = "WYD_ASSET_S3_SECRET_ACCESS_KEY"
	EnvManifest      = "WYD_ASSET_MANIFEST"       // optional asset manifest version label
	EnvAuthUser      = "WYD_BASIC_AUTH_USER"      // private deployment credential
	EnvAuthPassword  = "WYD_BASIC_AUTH_PASSWORD"  //
	EnvPortalURL     = "WYD_PORTAL_URL"           // portal account gate (exclusive with Basic)
	EnvPortalSecret  = "WYD_PORTAL_TICKET_SECRET" // HMAC key shared with the portal
	EnvForwardedFor  = "WYD_FORWARDED_FOR"        // "first" or "last" X-Forwarded-For entry (default last)
	EnvAllowPublic   = "WYD_ALLOW_PUBLIC"         // "true" to run without a credential
	EnvMaxConns      = "WYD_MAX_CONNS"            // optional limits
	EnvMaxConnsPerIP = "WYD_MAX_CONNS_PER_IP"
	EnvChatEnabled   = "WYD_CHAT_ENABLED" // "false" removes the page chat (default on)
)

// FromEnv builds a configuration for a TLS-terminating platform. It requires a
// credential (Basic or the portal gate) unless WYD_ALLOW_PUBLIC=true is set
// explicitly, because the page serves the operator's game data. getenv is os.Getenv in production.
func FromEnv(getenv func(string) string) (*Config, error) {
	var errs []error
	need := func(k string) string {
		v := strings.TrimSpace(getenv(k))
		if v == "" {
			errs = append(errs, fmt.Errorf("%s is required", k))
		}
		return v
	}
	port := need(EnvPort)
	origin := strings.TrimSuffix(need(EnvPublicOrigin), "/")
	target := need(EnvTarget)
	version, err := strconv.Atoi(need(EnvClientVersion))
	if err != nil && getenv(EnvClientVersion) != "" {
		errs = append(errs, fmt.Errorf("%s must be an integer", EnvClientVersion))
	}
	channel := strings.TrimSpace(getenv(EnvChannel))
	if channel == "" {
		channel = "server"
	}
	var wsURL string
	if u, perr := url.Parse(origin); perr == nil && u.Host != "" {
		wsURL = "wss://" + u.Host + "/ws/" + channel
	}
	c := &Config{
		Listen:               "0.0.0.0:" + port,
		TLSTerminatedByProxy: true,
		ForwardedFor:         strings.TrimSpace(getenv(EnvForwardedFor)),
		AllowedOrigins:       []string{origin},
		StaticDir:            strings.TrimSpace(getenv(EnvStaticDir)),
		AssetDir:             strings.TrimSpace(getenv(EnvAssetDir)),
		AssetManifestVersion: strings.TrimSpace(getenv(EnvManifest)),
		DefaultChannel:       channel,
		Channels:             []Channel{{Name: channel, Target: target, PublicWSURL: wsURL, ClientVersion: version}},
	}
	if b := strings.TrimSpace(getenv(EnvS3Bucket)); b != "" {
		c.AssetS3 = &S3Assets{
			Endpoint: strings.TrimSuffix(strings.TrimSpace(getenv(EnvS3Endpoint)), "/"),
			Region:   strings.TrimSpace(getenv(EnvS3Region)), Bucket: b,
			Prefix: strings.TrimSpace(getenv(EnvS3Prefix)), URLStyle: strings.TrimSpace(getenv(EnvS3URLStyle)),
			AccessKeyID: getenv(EnvS3KeyID), SecretAccessKey: getenv(EnvS3Secret),
		}
		if c.AssetS3.Region == "" {
			c.AssetS3.Region = "auto"
		}
		// The image sets WYD_ASSET_DIR by default; a bucket replaces it.
		c.AssetDir = ""
	}
	user, pass := getenv(EnvAuthUser), getenv(EnvAuthPassword)
	if user != "" || pass != "" {
		c.BasicAuth = &BasicAuth{User: user, Password: pass}
	}
	portal, secret := strings.TrimSuffix(strings.TrimSpace(getenv(EnvPortalURL)), "/"), getenv(EnvPortalSecret)
	if portal != "" || secret != "" {
		// Both credentials at once are rejected by Validate.
		c.PortalAuth = &PortalAuth{URL: portal, TicketSecret: secret}
	}
	if c.BasicAuth == nil && c.PortalAuth == nil && getenv(EnvAllowPublic) != "true" {
		errs = append(errs, fmt.Errorf("set %s/%s, %s/%s, or %s=true for a public deployment",
			EnvAuthUser, EnvAuthPassword, EnvPortalURL, EnvPortalSecret, EnvAllowPublic))
	}
	for key, dst := range map[string]*int{EnvMaxConns: &c.Limits.MaxConns, EnvMaxConnsPerIP: &c.Limits.MaxConnsPerIP} {
		if v := getenv(key); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n <= 0 {
				errs = append(errs, fmt.Errorf("%s must be a positive integer", key))
			}
			*dst = n
		}
	}
	switch v := strings.TrimSpace(getenv(EnvChatEnabled)); v {
	case "", "true":
	case "false":
		off := false
		c.Chat.Enabled = &off
	default:
		errs = append(errs, fmt.Errorf("%s must be true or false", EnvChatEnabled))
	}
	if len(errs) > 0 {
		return nil, fmt.Errorf("environment configuration: %w", errors.Join(errs...))
	}
	c.Defaults()
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("invalid environment configuration: %w", err)
	}
	return c, nil
}
