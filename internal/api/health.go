package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/xrdavies/mob/internal/actuate"
	"github.com/xrdavies/mob/internal/task"
)

// APIVersion is advertised on /health; clients gate features on it.
const APIVersion = 3

var features = []string{"queue", "activities", "sessionAdmin", "events", "screen", "uploads", "taskOptions", "vncProxy"}

// check is one readiness item; Unknown means mobd cannot tell yet.
type check struct {
	OK      bool   `json:"ok"`
	Unknown bool   `json:"unknown,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

// healthCache keeps /health cheap for clients that poll it.
type healthCache struct {
	mu     sync.Mutex
	at     time.Time
	checks map[string]check
}

const healthTTL = 10 * time.Second

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	models := s.cfg.Models
	if models == nil {
		models = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "service": "mobd", "apiVersion": APIVersion,
		"vncViewUrl": s.cfg.VNCViewURL, "runner": task.RunnerCodex, "mobMcp": s.cfg.MobMCPCommand,
		"maxRunning": max(s.cfg.MaxRunning, 1), "features": features,
		"models": models, "efforts": Efforts, "checks": s.readiness(r.Context()),
		"vncSessions": s.vncSessions.Load(),
	})
}

func (s *Server) readiness(ctx context.Context) map[string]check {
	s.health.mu.Lock()
	defer s.health.mu.Unlock()
	if s.health.checks != nil && time.Since(s.health.at) < healthTTL {
		return s.health.checks
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	checks := map[string]check{
		"codex":     codexCheck(ctx, s.cfg.CodexBin),
		"actuation": binaryCheck(s.cfg.MobMCPCommand),
	}
	if s.cfg.UsesBuiltinMCP() {
		checks["actuation"] = check{OK: true, Detail: "built-in (mobd mcp)"}
	}
	checks["accessibility"], checks["screenRecording"] = permissionChecks()
	checks["vnc"] = dialCheck(ctx, s.vncAddr())
	if !checks["vnc"].OK {
		checks["vnc"] = check{Detail: s.vncAddr() + " unreachable; turn on Screen Sharing in System Settings > General > Sharing"}
	}
	s.health.at, s.health.checks = time.Now(), checks
	return checks
}

// permissionChecks reports macOS TCC grants as seen by mobd; `mobd mcp`
// children launched through Codex share the same responsible app.
func permissionChecks() (check, check) {
	p, err := currentPermissions()
	if err != nil {
		return check{Unknown: true, Detail: err.Error()}, check{Unknown: true, Detail: err.Error()}
	}
	ax := check{OK: p.Accessibility}
	if !ax.OK {
		ax.Detail = "grant Accessibility to the app that launches mobd (System Settings > Privacy & Security > Accessibility)"
	}
	sr := check{OK: p.ScreenRecording}
	if !sr.OK {
		sr.Detail = "grant Screen Recording to the app that launches mobd (System Settings > Privacy & Security > Screen & System Audio Recording)"
	}
	return ax, sr
}

// currentPermissions is swapped in tests.
var currentPermissions = actuate.CurrentPermissions

func codexCheck(ctx context.Context, bin string) check {
	path, err := exec.LookPath(bin)
	if err != nil {
		return check{Detail: fmt.Sprintf("%q not found; install the Codex CLI or set MOBD_CODEX_BIN", bin)}
	}
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return check{Detail: fmt.Sprintf("%s --version failed: %v", path, err)}
	}
	return check{OK: true, Detail: fmt.Sprintf("%s (%s)", path, strings.TrimSpace(string(out)))}
}

func binaryCheck(bin string) check {
	path, err := exec.LookPath(bin)
	if err != nil {
		return check{Detail: fmt.Sprintf("%q not found; set MOBD_MOB_MCP_COMMAND", bin)}
	}
	return check{OK: true, Detail: path}
}

func dialCheck(ctx context.Context, addr string) check {
	conn, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return check{Detail: fmt.Sprintf("%s unreachable: %v", addr, err)}
	}
	conn.Close()
	return check{OK: true, Detail: addr + " reachable"}
}
