// Package runner defines the contract between mobd and agent runtimes.
package runner

import (
	"context"

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

// Runner executes one turn and blocks until it finishes or ctx is cancelled.
// Model and effort come from the task itself.
type Runner interface {
	Start(ctx context.Context, t *task.Task, opts Options, emit EmitFunc) error
}
