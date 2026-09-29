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
	EnvPort          = "PORT"                   // listen port given by the platform
	EnvPublicOrigin  = "WYD_PUBLIC_ORIGIN"      // https://host the browser uses
	EnvTarget        = "WYD_TARGET"             // tmserver host:port (private network)
	EnvClientVersion = "WYD_CLIENT_VERSION"     // AccountLogin version of the target
	EnvChannel       = "WYD_CHANNEL"            // public channel name (default "server")
	EnvStaticDir     = "WYD_STATIC_DIR"         // built page + runtime (in the image)
	EnvAssetDir      = "WYD_ASSET_DIR"          // operator game data (mounted volume)
	EnvManifest      = "WYD_ASSET_MANIFEST"     // optional asset manifest version label
	EnvAuthUser      = "WYD_BASIC_AUTH_USER"    // private deployment credential
	EnvAuthPassword  = "WYD_BASIC_AUTH_PASSWORD" //
	EnvAllowPublic   = "WYD_ALLOW_PUBLIC"       // "true" to run without a credential
	EnvMaxConns      = "WYD_MAX_CONNS"          // optional limits
	EnvMaxConnsPerIP = "WYD_MAX_CONNS_PER_IP"
)

// FromEnv builds a configuration for a TLS-terminating platform. It requires a
// credential unless WYD_ALLOW_PUBLIC=true is set explicitly, because the page
// serves the operator's game data. getenv is os.Getenv in production.
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
		AllowedOrigins:       []string{origin},
		StaticDir:            strings.TrimSpace(getenv(EnvStaticDir)),
		AssetDir:             strings.TrimSpace(getenv(EnvAssetDir)),
		AssetManifestVersion: strings.TrimSpace(getenv(EnvManifest)),
		DefaultChannel:       channel,
		Channels: []Channel{{Name: channel, Target: target, PublicWSURL: wsURL, ClientVersion: version}},
	}
	user, pass := getenv(EnvAuthUser), getenv(EnvAuthPassword)
	switch {
	case user != "" || pass != "":
		c.BasicAuth = &BasicAuth{User: user, Password: pass}
	case getenv(EnvAllowPublic) != "true":
		errs = append(errs, fmt.Errorf("set %s/%s, or %s=true for a public deployment",
			EnvAuthUser, EnvAuthPassword, EnvAllowPublic))
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
	if len(errs) > 0 {
		return nil, fmt.Errorf("environment configuration: %w", errors.Join(errs...))
	}
	c.Defaults()
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("invalid environment configuration: %w", err)
	}
	return c, nil
}
