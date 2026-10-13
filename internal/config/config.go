package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds mobd runtime settings (env-driven for Phase 1).
type Config struct {
	ListenAddr    string
	CodexBin      string
	CodexWorkDir  string
	MobMCPCommand string
	MobMCPArgs    []string
	SharedSecret  string
	VNCViewURL    string
	StatePath     string
	CORSOrigins   []string
	MaxRunning    int
	DataDir       string
	Models        []string
	VNCAddr       string
}

// Load reads configuration from environment variables.
//
//	MOBD_LISTEN          HTTP bind (default :8080)
//	MOBD_CODEX_BIN       Codex executable (default codex)
//	MOBD_CODEX_WORKDIR   Working directory for Codex (default cwd)
//	MOBD_MOB_MCP_COMMAND Absolute path to mob-mcp (or python -m launcher)
//	MOBD_MOB_MCP_ARGS    JSON array of args, e.g. ["-m","mob_mcp"] (default [])
//	MOBD_SHARED_SECRET   Optional bearer/shared secret for mutating routes
//	MOBD_VNC_VIEW_URL    Human svnc viewOnly URL (returned in health/info)
//	MOBD_STATE_PATH      Conversation snapshot (default user config dir/mob/state.json)
//	MOBD_CORS_ORIGINS    Comma-separated browser origins (Tauri dev defaults)
//	MOBD_MAX_RUNNING     Tasks allowed to run at once across sessions (default 1: one desktop)
//	MOBD_DATA_DIR        Root for artifacts/ (default: directory of MOBD_STATE_PATH)
//	MOBD_MODELS          Comma-separated model IDs offered to clients (default: Codex default only)
//	MOBD_VNC_ADDR        host:port probed by the /health VNC check (default: no check)
func Load() Config {
	cwd, _ := os.Getwd()
	stateDir, err := os.UserConfigDir()
	if err != nil {
		stateDir = cwd
	}
	cfg := Config{
		ListenAddr:    envOr("MOBD_LISTEN", ":8080"),
		CodexBin:      envOr("MOBD_CODEX_BIN", "codex"),
		CodexWorkDir:  envOr("MOBD_CODEX_WORKDIR", cwd),
		MobMCPCommand: envOr("MOBD_MOB_MCP_COMMAND", "mob-mcp"),
		MobMCPArgs:    nil,
		SharedSecret:  os.Getenv("MOBD_SHARED_SECRET"),
		VNCViewURL:    os.Getenv("MOBD_VNC_VIEW_URL"),
		StatePath:     envOr("MOBD_STATE_PATH", filepath.Join(stateDir, "mob", "state.json")),
		CORSOrigins:   corsOrigins(os.Getenv("MOBD_CORS_ORIGINS")),
		MaxRunning:    1,
		Models:        splitList(os.Getenv("MOBD_MODELS")),
		VNCAddr:       strings.TrimSpace(os.Getenv("MOBD_VNC_ADDR")),
	}
	cfg.DataDir = envOr("MOBD_DATA_DIR", filepath.Dir(cfg.StatePath))
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("MOBD_MAX_RUNNING"))); err == nil && n > 0 {
		cfg.MaxRunning = n
	}
	if raw := strings.TrimSpace(os.Getenv("MOBD_MOB_MCP_ARGS")); raw != "" {
		var args []string
		if err := json.Unmarshal([]byte(raw), &args); err == nil {
			cfg.MobMCPArgs = args
		} else {
			// fallback: comma-separated
			for _, p := range strings.Split(raw, ",") {
				p = strings.TrimSpace(p)
				if p != "" {
					cfg.MobMCPArgs = append(cfg.MobMCPArgs, p)
				}
			}
		}
	}
	return cfg
}

func corsOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{
			"http://localhost:1420",
			"http://127.0.0.1:1420",
			"tauri://localhost",
			"http://tauri.localhost",
		}
	}
	return splitList(raw)
}

func splitList(raw string) []string {
	var items []string
	for _, item := range strings.Split(raw, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// PortHint returns listen port for docs (best-effort).
func (c Config) PortHint() int {
	addr := c.ListenAddr
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		if p, err := strconv.Atoi(addr[i+1:]); err == nil {
			return p
		}
	}
	return 8080
}
