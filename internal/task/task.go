package task

import "time"

// Status is the Phase 1 task state machine.
type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

// RunnerCodex is the only Phase 1 runner.
const RunnerCodex = "codex"

// Task is the API-facing task snapshot.
type Task struct {
	ID         string    `json:"id"`
	Prompt     string    `json:"prompt"`
	Status     Status    `json:"status"`
	Runner     string    `json:"runner"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Error      *string   `json:"error"`
	VNCViewURL string    `json:"vncViewUrl,omitempty"`
}

// Event is streamed over SSE and retained for late subscribers.
type Event struct {
	Type      string    `json:"type"` // status | log | progress | error
	Message   string    `json:"message,omitempty"`
	Status    Status    `json:"status,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// CreateRequest is the POST /tasks body.
type CreateRequest struct {
	Prompt string `json:"prompt"`
}
