package codex

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	err := r.Start(context.Background(), tk, func(ev task.Event) error {
		logs = append(logs, ev.Message)
		return nil
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
	args := r.buildArgs("")
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "exec") || !strings.Contains(joined, "mcp_servers.mob-mcp.command") {
		t.Fatalf("args %v", args)
	}
	if args[len(args)-1] != "-" || !strings.Contains(joined, "--json") {
		t.Fatalf("stdin prompt and JSON required: %v", args)
	}
	resumed := strings.Join(r.buildArgs("thread-123"), " ")
	if !strings.Contains(resumed, "resume -- thread-123 -") || strings.Contains(resumed, "--last") {
		t.Fatalf("must resume explicit thread: %s", resumed)
	}
}

func fakeCodex(t *testing.T, script string) *Runner {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "codex-test")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+script), 0700); err != nil {
		t.Fatal(err)
	}
	return New(config.Config{CodexBin: bin, CodexWorkDir: dir, MobMCPCommand: "mob-mcp"})
}

func TestStartDrainsReplyBeforeReturning(t *testing.T) {
	r := fakeCodex(t, `cat > prompt.txt
printf '%s\n' '{"type":"thread.started","thread_id":"thread-1"}'
i=0
while [ "$i" -lt 1500 ]; do
  printf '%s\n' '{"type":"item.completed","item":{"id":"tool","type":"command_execution","aggregated_output":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}}'
  i=$((i + 1))
done
printf '%s\n' '{"type":"item.completed","item":{"id":"reply","type":"agent_message","text":"final reply"}}' '{"type":"turn.completed"}'
`)
	var mu sync.Mutex
	logs, reply := 0, ""
	err := r.Start(context.Background(), &task.Task{ID: "t", Prompt: "--a literal prompt\n第二行"}, func(ev task.Event) error {
		mu.Lock()
		defer mu.Unlock()
		if strings.HasPrefix(ev.Message, "[codex]") {
			logs++
			time.Sleep(10 * time.Microsecond)
		}
		if ev.Type == "message" {
			reply = ev.Message
		}
		return nil
	})
	if err != nil || logs != 1501 || reply != "final reply" {
		t.Fatalf("err=%v logs=%d reply=%q", err, logs, reply)
	}
	prompt, err := os.ReadFile(filepath.Join(r.cfg.CodexWorkDir, "prompt.txt"))
	if err != nil || string(prompt) != "--a literal prompt\n第二行" {
		t.Fatalf("stdin prompt=%q err=%v", prompt, err)
	}
}

func TestCancelStopsChildAndDrainsReaders(t *testing.T) {
	r := fakeCodex(t, `printf '%s\n' '{"type":"thread.started","thread_id":"thread-1"}'
sleep 30
`)
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- r.Start(context.Background(), &task.Task{ID: "t", Prompt: "hi"}, func(ev task.Event) error {
			if ev.Type == "thread" {
				close(started)
			}
			return nil
		})
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("runner did not start")
	}
	if err := r.Cancel("t"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel left child output pipes open")
	}
}

func TestExitedParentCannotLeaveOutputReadersHanging(t *testing.T) {
	r := fakeCodex(t, `sleep 30 &
printf '%s\n' '{"type":"thread.started","thread_id":"thread-1"}' '{"type":"item.completed","item":{"id":"reply","type":"agent_message","text":"answer"}}' '{"type":"turn.completed"}'
`)
	done := make(chan error, 1)
	go func() { done <- r.Start(context.Background(), &task.Task{ID: "t", Prompt: "hi"}, nil) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error for a child retaining output pipes")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("exited parent left output readers hanging")
	}
}

func TestStructuredEvents(t *testing.T) {
	for _, tc := range []struct {
		name, output string
		wantError    bool
	}{
		{"reply", "{\"type\":\"thread.started\",\"thread_id\":\"one\"}\n{\"type\":\"item.completed\",\"item\":{\"id\":\"m\",\"type\":\"agent_message\",\"text\":\"回复\\ntext\"}}\n{\"type\":\"turn.completed\"}", false},
		{"failed", `{"type":"turn.failed","error":{"message":"provider unavailable"}}`, true},
		{"bad JSON", "not JSON", true},
		{"missing completion", `{"type":"turn.started"}`, true},
		{"missing thread", `{"type":"thread.started"}`, true},
		{"empty completion", `{"type":"turn.completed"}`, true},
		{"missing item ID", `{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}`, true},
		{"oversized event", strings.Repeat("x", 8*1024*1024+1), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var messages []string
			err := streamJSON(strings.NewReader(tc.output), func(ev task.Event) error {
				if ev.Type == "message" {
					messages = append(messages, ev.Message)
				}
				return nil
			})
			if (err != nil) != tc.wantError {
				t.Fatalf("err=%v", err)
			}
			if !tc.wantError && (len(messages) != 1 || messages[0] != "回复\ntext") {
				t.Fatalf("messages=%q", messages)
			}
		})
	}
	storageErr := errors.New("disk full")
	if err := streamJSON(strings.NewReader(`{"type":"thread.started","thread_id":"one"}`), func(task.Event) error { return storageErr }); !errors.Is(err, storageErr) {
		t.Fatalf("must propagate persistence errors: %v", err)
	}
}
