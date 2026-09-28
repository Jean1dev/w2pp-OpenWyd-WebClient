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
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(*cfgPath, log); err != nil {
		log.Error("gateway stopped", "err", err)
		os.Exit(1)
	}
}

func run(cfgPath string, log *slog.Logger) error {
	cfg, err := config.Load(cfgPath)
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
		"channels", channels, "static", cfg.StaticDir != "")

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
