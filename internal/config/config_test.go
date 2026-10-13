package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestConversationStatePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "custom-state.json")
	t.Setenv("MOBD_STATE_PATH", path)
	if got := Load().StatePath; got != path {
		t.Fatalf("state path=%q", got)
	}
	t.Setenv("MOBD_STATE_PATH", "")
	dir, err := os.UserConfigDir()
	if err != nil {
		t.Skip("user config directory unavailable")
	}
	if got := Load().StatePath; got != filepath.Join(dir, "mob", "state.json") {
		t.Fatalf("default state path=%q", got)
	}
}

func TestLoadCORSOrigins(t *testing.T) {
	defaults := []string{"http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost"}
	for _, tc := range []struct {
		name, raw string
		want      []string
	}{
		{"default", "", defaults},
		{"whitespace", "  ", defaults},
		{"override", " https://home.example, , http://localhost:3000 ", []string{"https://home.example", "http://localhost:3000"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MOBD_CORS_ORIGINS", tc.raw)
			if got := Load().CORSOrigins; !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("origins %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMCPDefaultsToBuiltinServer(t *testing.T) {
	t.Setenv("MOBD_MOB_MCP_COMMAND", "")
	t.Setenv("MOBD_MOB_MCP_ARGS", "[]") // as in scripts/env.example; must not drop "mcp"
	cfg := Load()
	exe, _ := BuiltinMCP()
	if cfg.MobMCPCommand != exe || !reflect.DeepEqual(cfg.MobMCPArgs, []string{"mcp"}) || !cfg.UsesBuiltinMCP() {
		t.Fatalf("builtin: %q %v", cfg.MobMCPCommand, cfg.MobMCPArgs)
	}
	t.Setenv("MOBD_MOB_MCP_COMMAND", "/opt/other-mcp")
	t.Setenv("MOBD_MOB_MCP_ARGS", `["--flag"]`)
	cfg = Load()
	if cfg.MobMCPCommand != "/opt/other-mcp" || !reflect.DeepEqual(cfg.MobMCPArgs, []string{"--flag"}) || cfg.UsesBuiltinMCP() {
		t.Fatalf("external: %q %v", cfg.MobMCPCommand, cfg.MobMCPArgs)
	}
}
