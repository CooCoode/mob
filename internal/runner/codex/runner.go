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
	"github.com/xrdavies/mob/internal/runner"
	"github.com/xrdavies/mob/internal/task"
)

// Runner starts Codex exec with mob-mcp MCP config injected.
// If the Codex binary is missing, it fails the task safely (no panic).
type Runner struct {
	cfg config.Config

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

// New creates a Codex runner.
func New(cfg config.Config) *Runner {
	return &Runner{
		cfg:     cfg,
		cancels: make(map[string]context.CancelFunc),
	}
}

var _ runner.Runner = (*Runner)(nil)

// Start runs Codex for the task asynchronously from the caller's perspective
// until the process exits. The caller should invoke Start in a goroutine or
// accept blocking until completion.
func (r *Runner) Start(ctx context.Context, t *task.Task, opts runner.Options, emit runner.EmitFunc) error {
	if emit == nil {
		emit = func(task.Event) error { return nil }
	}

	bin := r.cfg.CodexBin
	path, lookErr := exec.LookPath(bin)
	if lookErr != nil {
		// Safe stub: do not crash mobd; surface a clear failure.
		msg := fmt.Sprintf("codex binary %q not found on PATH (%v); stub mode — install Codex CLI or set MOBD_CODEX_BIN", bin, lookErr)
		if err := emit(task.Event{Type: "log", Message: msg}); err != nil {
			return err
		}
		return errors.New(msg)
	}

	runCtx, cancelRun := context.WithCancelCause(ctx)
	cancel := func() { cancelRun(context.Canceled) }
	r.mu.Lock()
	r.cancels[t.ID] = cancel
	r.mu.Unlock()
	defer func() {
		cancel()
		r.mu.Lock()
		delete(r.cancels, t.ID)
		r.mu.Unlock()
	}()

	args := r.buildArgs(t, opts.Images)
	cmd := exec.CommandContext(runCtx, path, args...)
	cmd.Dir = r.cfg.CodexWorkDir
	cmd.Env = os.Environ()
	cmd.Stdin = strings.NewReader(t.Prompt)
	// Kill the process group so cancelled tools cannot keep output pipes open.
	// shortcut: hard daemon crashes need an external process supervisor; graceful shutdown cancels this group.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 3 * time.Second
	stdout, stdoutWriter := io.Pipe()
	stderr, stderrWriter := io.Pipe()
	defer stdout.Close()
	defer stderr.Close()
	defer stdoutWriter.Close()
	defer stderrWriter.Close()
	// Writer outputs let os/exec drain its pipes during Wait, including trailing replies.
	cmd.Stdout, cmd.Stderr = stdoutWriter, stderrWriter

	if err := emit(task.Event{
		Type:      "log",
		Message:   fmt.Sprintf("starting %s %s", path, strings.Join(args, " ")),
		Timestamp: time.Now().UTC(),
	}); err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start codex: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	var stdoutErr, stderrErr error
	go func() {
		defer wg.Done()
		stdoutErr = streamJSON(stdout, emit, opts.SaveImage)
		if stdoutErr != nil {
			cancelRun(stdoutErr)
		}
		_ = stdout.CloseWithError(stdoutErr)
	}()
	go func() {
		defer wg.Done()
		stderrErr = streamLines(stderr, func(line string) error {
			return emit(task.Event{Type: "log", Message: "[stderr] " + line})
		})
		if stderrErr != nil {
			cancelRun(stderrErr)
		}
		_ = stderr.CloseWithError(stderrErr)
	}()
	waitErr := cmd.Wait()
	if runCtx.Err() != nil || errors.Is(waitErr, exec.ErrWaitDelay) {
		// The parent has exited now, so it cannot create more children in the group.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	_ = stdoutWriter.Close()
	_ = stderrWriter.Close()
	wg.Wait()

	if cause := context.Cause(runCtx); cause != nil {
		return cause
	}
	if waitErr != nil {
		msg := fmt.Sprintf("codex exited: %v", waitErr)
		return errors.New(msg)
	}
	return emit(task.Event{Type: "log", Message: "codex exited successfully"})
}

// Cancel requests termination of a running Codex process.
func (r *Runner) Cancel(taskID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cancel, ok := r.cancels[taskID]; ok {
		cancel()
	}
	return nil
}

func (r *Runner) buildArgs(t *task.Task, images []string) []string {
	// Non-interactive: codex exec. Desktop actuation needs a permissive sandbox
	// on the office Mac; tune via future config if needed.
	args := []string{
		"exec",
		"--sandbox", "danger-full-access",
		"--json",
		"--skip-git-repo-check",
		"-c", fmt.Sprintf("mcp_servers.mob-mcp.command=%q", r.cfg.MobMCPCommand),
	}
	if len(r.cfg.MobMCPArgs) > 0 {
		args = append(args, "-c", fmt.Sprintf("mcp_servers.mob-mcp.args=%s", tomlStringArray(r.cfg.MobMCPArgs)))
	} else {
		args = append(args, "-c", "mcp_servers.mob-mcp.args=[]")
	}
	if t.Effort != "" {
		args = append(args, "-c", fmt.Sprintf("model_reasoning_effort=%q", t.Effort))
	}
	// Turn options go after "resume" so they apply to the resumed thread too.
	var turn []string
	if t.Model != "" {
		turn = append(turn, "--model="+t.Model)
	}
	for _, image := range images {
		turn = append(turn, "--image="+image)
	}
	if t.ThreadID != "" {
		args = append(args, "resume")
		args = append(args, turn...)
		args = append(args, "--", t.ThreadID, "-")
	} else {
		args = append(args, turn...)
		args = append(args, "--", "-")
	}
	return args
}

func tomlStringArray(items []string) string {
	parts := make([]string, len(items))
	for i, s := range items {
		parts[i] = fmt.Sprintf("%q", s)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func streamLines(r io.Reader, consume func(string) error) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		if err := consume(sc.Text()); err != nil {
			return err
		}
	}
	return sc.Err()
}
