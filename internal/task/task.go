package task

import (
	"encoding/json"
	"time"
)

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
	ID          string     `json:"id"`
	SessionID   string     `json:"sessionId"`
	ThreadID    string     `json:"threadId,omitempty"`
	EventID     int64      `json:"eventId"`
	Prompt      string     `json:"prompt"`
	Status      Status     `json:"status"`
	Runner      string     `json:"runner"`
	Model       string     `json:"model,omitempty"`
	Effort      string     `json:"effort,omitempty"`
	Attachments []string   `json:"attachments,omitempty"`
	Usage       *Usage     `json:"usage,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	Error       *string    `json:"error"`
	VNCViewURL  string     `json:"vncViewUrl,omitempty"`
	// QueuePosition is computed on read (1-based) while the task waits for the desktop.
	QueuePosition int `json:"queuePosition,omitempty"`
}

// Usage is the token accounting reported when a turn completes.
type Usage struct {
	InputTokens           int64 `json:"inputTokens"`
	CachedInputTokens     int64 `json:"cachedInputTokens"`
	OutputTokens          int64 `json:"outputTokens"`
	ReasoningOutputTokens int64 `json:"reasoningOutputTokens"`
}

// Activity kinds and states rendered as timeline cards.
const (
	ActivityTool       = "tool"
	ActivityCommand    = "command"
	ActivityReasoning  = "reasoning"
	ActivityPlan       = "plan"
	ActivityFileChange = "file_change"
	ActivityWebSearch  = "web_search"
	ActivityNotice     = "notice"

	ActivityRunning   = "running"
	ActivityCompleted = "completed"
	ActivityFailed    = "failed"
)

// Activity is one persisted agent step (tool call, command, plan…), upserted by ID.
type Activity struct {
	ID        string          `json:"id"`
	TaskID    string          `json:"taskId"`
	Kind      string          `json:"kind"`
	Status    string          `json:"status"`
	Title     string          `json:"title"`
	Server    string          `json:"server,omitempty"`
	Tool      string          `json:"tool,omitempty"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
	Command   string          `json:"command,omitempty"`
	ExitCode  *int            `json:"exitCode,omitempty"`
	Text      string          `json:"text,omitempty"`
	Truncated bool            `json:"truncated,omitempty"`
	Error     string          `json:"error,omitempty"`
	Images    []string        `json:"images,omitempty"`
	Items     []PlanItem      `json:"items,omitempty"`
	Changes   []FileChange    `json:"changes,omitempty"`
	StartedAt time.Time       `json:"startedAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type PlanItem struct {
	Text      string `json:"text"`
	Completed bool   `json:"completed"`
}

type FileChange struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
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
	Pinned       bool      `json:"pinned"`
	Archived     bool      `json:"archived"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Messages     []Message `json:"messages,omitempty"`
}

// Event is streamed over SSE and retained for late subscribers.
type Event struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"` // status | log | progress | error | thread | message | activity | usage
	Message   string    `json:"message,omitempty"`
	MessageID string    `json:"messageId,omitempty"`
	ThreadID  string    `json:"threadId,omitempty"`
	Status    Status    `json:"status,omitempty"`
	Activity  *Activity `json:"activity,omitempty"`
	Usage     *Usage    `json:"usage,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// CreateRequest is the POST /tasks body.
type CreateRequest struct {
	Prompt      string   `json:"prompt"`
	SessionID   string   `json:"sessionId,omitempty"`
	Model       string   `json:"model,omitempty"`
	Effort      string   `json:"effort,omitempty"`
	Attachments []string `json:"attachments,omitempty"`
}

// TurnOptions are per-turn runner settings validated by the API.
type TurnOptions struct {
	Model       string
	Effort      string
	Attachments []string
}

func (s Status) Terminal() bool {
	return s == StatusSucceeded || s == StatusFailed || s == StatusCancelled
}
