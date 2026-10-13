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
	"github.com/xrdavies/mob/internal/runner"
	"github.com/xrdavies/mob/internal/runner/claude"
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
	available := map[string]runner.Runner{codex.Name: codex.New(cfg), claude.Name: claude.New(cfg)}
	var runners []runner.Runner
	for _, name := range cfg.Runners {
		rn, ok := available[name]
		if !ok {
			log.Fatalf("MOBD_RUNNERS: unknown runner %q (known: codex, claude)", name)
		}
		runners = append(runners, rn)
	}
	if _, err := runner.NewRegistry(cfg.DefaultRunner, runners...); err != nil {
		log.Fatalf("MOBD_DEFAULT_RUNNER: %v", err)
	}
	srv := api.New(cfg, store, runners...)

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("mobd listening on %s (runners=%s default=%s codex=%s mob-mcp=%s %s)", cfg.ListenAddr, strings.Join(cfg.Runners, ","), cfg.DefaultRunner, cfg.CodexBin, cfg.MobMCPCommand, strings.Join(cfg.MobMCPArgs, " "))
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
