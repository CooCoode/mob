package codex

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/task"
)

func TestStartMissingBinary(t *testing.T) {
	r := New(config.Config{
		CodexBin:      "definitely-not-codex-binary",
		CodexWorkDir:  t.TempDir(),
		MobMCPCommand: "/tmp/mob-mcp",
		MobMCPArgs:    []string{"-m", "mob_mcp"},
	})
	tk := &task.Task{ID: "t1", Prompt: "hi"}
	var logs []string
	err := r.Start(context.Background(), tk, func(ev task.Event) {
		logs = append(logs, ev.Message)
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("err %v", err)
	}
	joined := strings.Join(logs, "\n")
	if !strings.Contains(joined, "stub mode") {
		t.Fatalf("logs %q", joined)
	}
}

func TestBuildArgsIncludesMCP(t *testing.T) {
	r := New(config.Config{
		MobMCPCommand: "/opt/mob-mcp",
		MobMCPArgs:    []string{"--verbose"},
	})
	args := r.buildArgs("do it")
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "exec") || !strings.Contains(joined, "mcp_servers.mob-mcp.command") {
		t.Fatalf("args %v", args)
	}
	if args[len(args)-1] != "do it" {
		t.Fatalf("prompt last: %v", args)
	}
	_ = time.Second
}
