package codex

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/task"
)

// EventFunc receives runner events for a task.
type EventFunc func(ev task.Event)

// Runner starts Codex exec with mob-mcp MCP config injected.
// If the Codex binary is missing, it fails the task safely (no panic).
type Runner struct {
	cfg config.Config

	mu      sync.Mutex
	procs   map[string]*exec.Cmd
	cancels map[string]context.CancelFunc
}

// New creates a Codex runner.
func New(cfg config.Config) *Runner {
	return &Runner{
		cfg:     cfg,
		procs:   make(map[string]*exec.Cmd),
		cancels: make(map[string]context.CancelFunc),
	}
}

// Start runs Codex for the task asynchronously from the caller's perspective
// until the process exits. The caller should invoke Start in a goroutine or
// accept blocking until completion.
func (r *Runner) Start(ctx context.Context, t *task.Task, emit EventFunc) error {
	if emit == nil {
		emit = func(task.Event) {}
	}

	bin := r.cfg.CodexBin
	path, lookErr := exec.LookPath(bin)
	if lookErr != nil {
		// Safe stub: do not crash mobd; surface a clear failure.
		msg := fmt.Sprintf("codex binary %q not found on PATH (%v); stub mode — install Codex CLI or set MOBD_CODEX_BIN", bin, lookErr)
		emit(task.Event{Type: "log", Message: msg, Timestamp: time.Now().UTC()})
		return errors.New(msg)
	}

	runCtx, cancel := context.WithCancel(ctx)
	r.mu.Lock()
	r.cancels[t.ID] = cancel
	r.mu.Unlock()
	defer func() {
		cancel()
		r.mu.Lock()
		delete(r.cancels, t.ID)
		delete(r.procs, t.ID)
		r.mu.Unlock()
	}()

	args := r.buildArgs(t.Prompt)
	cmd := exec.CommandContext(runCtx, path, args...)
	cmd.Dir = r.cfg.CodexWorkDir
	cmd.Env = os.Environ()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	emit(task.Event{
		Type:      "log",
		Message:   fmt.Sprintf("starting %s %s", path, strings.Join(args, " ")),
		Timestamp: time.Now().UTC(),
	})

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start codex: %w", err)
	}

	r.mu.Lock()
	r.procs[t.ID] = cmd
	r.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); streamLines(stdout, "stdout", emit) }()
	go func() { defer wg.Done(); streamLines(stderr, "stderr", emit) }()

	waitErr := cmd.Wait()
	wg.Wait()

	if runCtx.Err() != nil {
		msg := "cancelled"
		emit(task.Event{Type: "status", Status: task.StatusCancelled, Message: msg, Timestamp: time.Now().UTC()})
		return context.Canceled
	}
	if waitErr != nil {
		msg := fmt.Sprintf("codex exited: %v", waitErr)
		emit(task.Event{Type: "log", Message: msg, Timestamp: time.Now().UTC()})
		return waitErr
	}
	emit(task.Event{Type: "log", Message: "codex exited successfully", Timestamp: time.Now().UTC()})
	return nil
}

// Cancel requests termination of a running Codex process.
func (r *Runner) Cancel(taskID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cancel, ok := r.cancels[taskID]; ok {
		cancel()
	}
	if cmd, ok := r.procs[taskID]; ok && cmd.Process != nil {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		time.AfterFunc(3*time.Second, func() {
			_ = cmd.Process.Kill()
		})
	}
	return nil
}

func (r *Runner) buildArgs(prompt string) []string {
	// Non-interactive: codex exec. Desktop actuation needs a permissive sandbox
	// on the office Mac; tune via future config if needed.
	args := []string{
		"exec",
		"--sandbox", "danger-full-access",
		"--skip-git-repo-check",
		"-c", fmt.Sprintf("mcp_servers.mob-mcp.command=%q", r.cfg.MobMCPCommand),
	}
	if len(r.cfg.MobMCPArgs) > 0 {
		args = append(args, "-c", fmt.Sprintf("mcp_servers.mob-mcp.args=%s", tomlStringArray(r.cfg.MobMCPArgs)))
	} else {
		args = append(args, "-c", "mcp_servers.mob-mcp.args=[]")
	}
	args = append(args, prompt)
	return args
}

func tomlStringArray(items []string) string {
	parts := make([]string, len(items))
	for i, s := range items {
		parts[i] = fmt.Sprintf("%q", s)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func streamLines(r io.Reader, label string, emit EventFunc) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		emit(task.Event{
			Type:      "log",
			Message:   fmt.Sprintf("[%s] %s", label, line),
			Timestamp: time.Now().UTC(),
		})
	}
}
