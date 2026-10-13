package task

import "time"

// Status describes one turn, not the lifetime of its conversation.
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
	SessionID  string    `json:"sessionId"`
	ThreadID   string    `json:"threadId,omitempty"`
	EventID    int64     `json:"eventId"`
	Prompt     string    `json:"prompt"`
	Status     Status    `json:"status"`
	Runner     string    `json:"runner"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Error      *string   `json:"error"`
	VNCViewURL string    `json:"vncViewUrl,omitempty"`
}

type Message struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"taskId"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

type Session struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	ThreadID     string    `json:"threadId,omitempty"`
	ActiveTaskID string    `json:"activeTaskId,omitempty"`
	Status       Status    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Messages     []Message `json:"messages,omitempty"`
}

// Event is streamed over SSE and retained for late subscribers.
type Event struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"` // status | log | progress | error | thread | message
	Message   string    `json:"message,omitempty"`
	MessageID string    `json:"messageId,omitempty"`
	ThreadID  string    `json:"threadId,omitempty"`
	Status    Status    `json:"status,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// CreateRequest is the POST /tasks body.
type CreateRequest struct {
	Prompt    string `json:"prompt"`
	SessionID string `json:"sessionId,omitempty"`
}

func (s Status) Terminal() bool {
	return s == StatusSucceeded || s == StatusFailed || s == StatusCancelled
}
