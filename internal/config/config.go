package config

import (
	"encoding/json"
	"os"
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
func Load() Config {
	cwd, _ := os.Getwd()
	cfg := Config{
		ListenAddr:    envOr("MOBD_LISTEN", ":8080"),
		CodexBin:      envOr("MOBD_CODEX_BIN", "codex"),
		CodexWorkDir:  envOr("MOBD_CODEX_WORKDIR", cwd),
		MobMCPCommand: envOr("MOBD_MOB_MCP_COMMAND", "mob-mcp"),
		MobMCPArgs:    nil,
		SharedSecret:  os.Getenv("MOBD_SHARED_SECRET"),
		VNCViewURL:    os.Getenv("MOBD_VNC_VIEW_URL"),
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
