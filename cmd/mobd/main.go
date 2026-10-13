package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xrdavies/mob/internal/api"
	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/runner/codex"
	"github.com/xrdavies/mob/internal/task"
)

func main() {
	cfg := config.Load()
	store, err := task.OpenStore(cfg.StatePath)
	if err != nil {
		log.Fatalf("open conversation state: %v", err)
	}
	runner := codex.New(cfg)
	srv := api.New(cfg, store, runner)

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("mobd listening on %s (codex=%s mob-mcp=%s)", cfg.ListenAddr, cfg.CodexBin, cfg.MobMCPCommand)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	srv.Close()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Printf("mobd stopped")
}
