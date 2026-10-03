// Command wydgateway relays browser WebSocket connections to operator-configured
// tmserver TCP endpoints. It carries bytes only; it contains no game rules.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/config"
	"github.com/Jean1dev/w2pp-OpenWyd-WebClient/gateway/internal/relay"
)

func main() {
	cfgPath := flag.String("config", "gateway.json", "operator configuration file")
	fromEnv := flag.Bool("env", false, "read the configuration from WYD_* variables (container deployments)")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	load := func() (*config.Config, error) { return config.Load(*cfgPath) }
	if *fromEnv {
		load = func() (*config.Config, error) { return config.FromEnv(os.Getenv) }
	}
	if err := run(load, log); err != nil {
		log.Error("gateway stopped", "err", err)
		os.Exit(1)
	}
}

func run(load func() (*config.Config, error), log *slog.Logger) error {
	cfg, err := load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	relayCtx, cancelRelays := context.WithCancel(context.Background())
	defer cancelRelays()
	g := relay.New(relayCtx, cfg, log)
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           g,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	channels := make([]string, 0, len(cfg.Channels))
	for _, ch := range cfg.Channels {
		channels = append(channels, ch.Name)
	}
	log.Info("gateway listening", "addr", cfg.Listen, "tls", cfg.TLSCert != "",
		"tlsProxy", cfg.TLSTerminatedByProxy, "forwardedFor", cfg.ForwardedFor, "channels", channels, "static", cfg.StaticDir != "",
		"assets", assetSource(cfg), "auth", authMode(cfg), "chat", cfg.Chat.On())

	errc := make(chan error, 1)
	go func() {
		if cfg.TLSCert != "" {
			errc <- srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			errc <- srv.ListenAndServe()
		}
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	log.Info("gateway shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = srv.Shutdown(shutCtx)
	// Hijacked WebSocket connections are not tracked by http.Server.
	cancelRelays()
	g.Wait()
	return err
}

// assetSource names where game data comes from, without secrets.
func assetSource(cfg *config.Config) string {
	switch {
	case cfg.AssetS3 != nil:
		return "s3:" + cfg.AssetS3.Bucket + "/" + cfg.AssetS3.Prefix
	case cfg.AssetDir != "":
		return "dir:" + cfg.AssetDir
	}
	return "none"
}

func authMode(cfg *config.Config) string {
	switch {
	case cfg.BasicAuth != nil:
		return "basic"
	case cfg.PortalAuth != nil:
		return "portal"
	}
	return "none"
}
