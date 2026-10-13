package config

import (
	"os"
	"path/filepath"
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
