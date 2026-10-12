package task

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var (
	ErrNotFound       = errors.New("task not found")
	ErrInvalidPrompt  = errors.New("prompt is required")
	ErrNotCancellable = errors.New("task is not cancellable")
)

// Store is an in-memory task store (Phase 1).
type Store struct {
	mu     sync.RWMutex
	tasks  map[string]*Task
	events map[string][]Event
	order  []string // newest last
}

// NewStore creates an empty store.
func NewStore() *Store {
	return &Store{
		tasks:  make(map[string]*Task),
		events: make(map[string][]Event),
	}
}

// Create inserts a queued task.
func (s *Store) Create(prompt string, vncViewURL string) (*Task, error) {
	prompt = trim(prompt)
	if prompt == "" {
		return nil, ErrInvalidPrompt
	}
	now := time.Now().UTC()
	t := &Task{
		ID:         newID(),
		Prompt:     prompt,
		Status:     StatusQueued,
		Runner:     RunnerCodex,
		CreatedAt:  now,
		UpdatedAt:  now,
		Error:      nil,
		VNCViewURL: vncViewURL,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[t.ID] = t
	s.order = append(s.order, t.ID)
	s.events[t.ID] = []Event{{
		Type:      "status",
		Status:    StatusQueued,
		Message:   "queued",
		Timestamp: now,
	}}
	return clone(t), nil
}

// Get returns a task snapshot.
func (s *Store) Get(id string) (*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(t), nil
}

// List returns tasks newest-first (max limit; 0 = all).
func (s *Store) List(limit int) []*Task {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := len(s.order)
	out := make([]*Task, 0, n)
	for i := n - 1; i >= 0; i-- {
		out = append(out, clone(s.tasks[s.order[i]]))
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// UpdateStatus sets status and optional error; appends a status event.
func (s *Store) UpdateStatus(id string, status Status, errMsg string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	now := time.Now().UTC()
	t.Status = status
	t.UpdatedAt = now
	if errMsg != "" {
		e := errMsg
		t.Error = &e
	} else if status == StatusSucceeded || status == StatusRunning || status == StatusQueued {
		t.Error = nil
	}
	ev := Event{
		Type:      "status",
		Status:    status,
		Message:   string(status),
		Timestamp: now,
	}
	if errMsg != "" {
		ev.Type = "error"
		ev.Message = errMsg
	}
	s.events[id] = append(s.events[id], ev)
	return clone(t), nil
}

// AppendEvent stores a non-status event (log/progress).
func (s *Store) AppendEvent(id string, ev Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tasks[id]; !ok {
		return ErrNotFound
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	t := s.tasks[id]
	t.UpdatedAt = ev.Timestamp
	s.events[id] = append(s.events[id], ev)
	return nil
}

// Events returns a copy of events for a task.
func (s *Store) Events(id string) ([]Event, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.tasks[id]; !ok {
		return nil, ErrNotFound
	}
	src := s.events[id]
	out := make([]Event, len(src))
	copy(out, src)
	return out, nil
}

// CanCancel returns the task if it is queued or running.
func (s *Store) CanCancel(id string) (*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	switch t.Status {
	case StatusQueued, StatusRunning:
		return clone(t), nil
	default:
		return clone(t), ErrNotCancellable
	}
}

func clone(t *Task) *Task {
	c := *t
	if t.Error != nil {
		e := *t.Error
		c.Error = &e
	}
	return &c
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n' || s[0] == '\r') {
		s = s[1:]
	}
	for len(s) > 0 {
		last := s[len(s)-1]
		if last == ' ' || last == '\t' || last == '\n' || last == '\r' {
			s = s[:len(s)-1]
			continue
		}
		break
	}
	return s
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000000000")))
	}
	return hex.EncodeToString(b[:])
}
