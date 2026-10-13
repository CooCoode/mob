// Package codex runs OpenAI Codex (`codex exec --json`) as a mob runner.
package codex

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/runner"
	"github.com/xrdavies/mob/internal/runner/cli"
	"github.com/xrdavies/mob/internal/task"
)

// Name identifies the Codex runner in tasks, sessions and /health.
const Name = "codex"

// Efforts are Codex's model_reasoning_effort values.
var Efforts = []string{"minimal", "low", "medium", "high", "xhigh"}

// Runner starts Codex exec with mob-mcp MCP config injected.
// If the Codex binary is missing, it fails the task safely (no panic).
type Runner struct {
	cfg config.Config
}

// New creates a Codex runner.
func New(cfg config.Config) *Runner {
	return &Runner{cfg: cfg}
}

var _ runner.Runner = (*Runner)(nil)

func (r *Runner) Info() runner.Info {
	models := r.cfg.CodexModels
	if models == nil {
		models = []string{}
	}
	return runner.Info{Name: Name, Label: "Codex", Models: models, Efforts: Efforts, Images: true, Resume: true}
}

func (r *Runner) Check(ctx context.Context) runner.Status {
	return cli.Version(ctx, "the Codex CLI", r.cfg.CodexBin, "MOBD_CODEX_BIN")
}

// Start runs one Codex turn and blocks until the process exits.
func (r *Runner) Start(ctx context.Context, t *task.Task, opts runner.Options, emit runner.EmitFunc) error {
	if emit == nil {
		emit = func(task.Event) error { return nil }
	}
	path, err := exec.LookPath(r.cfg.CodexBin)
	if err != nil {
		return cli.Missing("codex", r.cfg.CodexBin, "MOBD_CODEX_BIN", err, emit)
	}
	return cli.Run(ctx, cli.Command{
		Name: "codex", Path: path, Args: r.buildArgs(t, opts.Images),
		Dir: r.cfg.CodexWorkDir, Env: os.Environ(), Stdin: strings.NewReader(t.Prompt),
	}, newParser(emit, opts.SaveImage), emit)
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
	if t.ResumeID != "" {
		args = append(args, "resume")
		args = append(args, turn...)
		args = append(args, "--", t.ResumeID, "-")
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
