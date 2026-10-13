// Package runner defines the contract between mobd and agent runtimes
// (Codex, Claude Code, …). Runners translate their agent's own output into
// neutral task events: resume, message, activity, usage, log.
package runner

import (
	"context"
	"fmt"
	"sort"

	"github.com/xrdavies/mob/internal/task"
)

// EmitFunc receives runner events for a task; an error stops the run.
type EmitFunc func(ev task.Event) error

// ImageSaver stores image bytes produced by a tool call and returns an artifact ID.
type ImageSaver func(mime string, data []byte) (string, error)

// Options carries per-run resources resolved by the API.
type Options struct {
	// Images are absolute paths attached to the prompt.
	Images []string
	// SaveImage persists screenshots from tool results; nil drops them.
	SaveImage ImageSaver
}

// Info describes what a runner supports. It is static: no processes are started.
type Info struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Models  []string `json:"models"`
	Efforts []string `json:"efforts"`
	// Images reports whether prompts accept image attachments.
	Images bool `json:"images"`
	// Resume reports whether a later turn can continue the agent's conversation.
	Resume bool `json:"resume"`
	// Cost reports whether usage includes a dollar cost.
	Cost bool `json:"cost"`
}

// Status is the readiness of a runner on this machine.
type Status struct {
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// Runner executes one turn and blocks until it finishes or ctx is cancelled.
// Model and effort come from the task; t.ResumeID continues an earlier turn.
type Runner interface {
	Info() Info
	Check(ctx context.Context) Status
	Start(ctx context.Context, t *task.Task, opts Options, emit EmitFunc) error
}

// Registry holds the enabled runners and the default for new conversations.
type Registry struct {
	runners map[string]Runner
	def     string
}

// NewRegistry registers runners; def must be one of them.
func NewRegistry(def string, runners ...Runner) (*Registry, error) {
	r := &Registry{runners: make(map[string]Runner), def: def}
	for _, rn := range runners {
		r.runners[rn.Info().Name] = rn
	}
	if r.runners[def] == nil {
		return nil, fmt.Errorf("default runner %q is not enabled", def)
	}
	return r, nil
}

// Get returns a runner by name.
func (r *Registry) Get(name string) (Runner, bool) {
	rn, ok := r.runners[name]
	return rn, ok
}

// Default is the runner for conversations that do not pick one.
func (r *Registry) Default() string { return r.def }

// All returns the runners with the default first, then by name.
func (r *Registry) All() []Runner {
	out := make([]Runner, 0, len(r.runners))
	for _, rn := range r.runners {
		out = append(out, rn)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i].Info().Name, out[j].Info().Name
		if (a == r.def) != (b == r.def) {
			return a == r.def
		}
		return a < b
	})
	return out
}
