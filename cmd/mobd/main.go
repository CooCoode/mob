package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/xrdavies/mob/internal/api"
	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/mcpserver"
	"github.com/xrdavies/mob/internal/runner/codex"
	"github.com/xrdavies/mob/internal/task"
)

// version is reported by `mobd mcp` to MCP clients.
const version = "0.3.0"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "mcp":
			// stdio MCP server launched by Codex; stdout is the transport.
			log.SetOutput(os.Stderr)
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			if err := mcpserver.Run(ctx, version); err != nil {
				os.Exit(1)
			}
			return
		case "serve":
		default:
			log.Fatalf("usage: mobd [serve|mcp]")
		}
	}
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
		log.Printf("mobd listening on %s (codex=%s mob-mcp=%s %s)", cfg.ListenAddr, cfg.CodexBin, cfg.MobMCPCommand, strings.Join(cfg.MobMCPArgs, " "))
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
