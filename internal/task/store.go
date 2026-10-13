package task

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound          = errors.New("task or session not found")
	ErrInvalidPrompt     = errors.New("prompt is required")
	ErrNotCancellable    = errors.New("task is not cancellable")
	ErrSessionBusy       = errors.New("session already has an active turn")
	ErrInvalidTransition = errors.New("task has already finished")
)

type state struct {
	Tasks    map[string]*Task    `json:"tasks"`
	Sessions map[string]*Session `json:"sessions"`
	Order    []string            `json:"order"`
}

// Store keeps conversations durable and task event delivery ordered.
type Store struct {
	mu      sync.RWMutex
	data    state
	path    string
	events  map[string][]Event
	changed map[string]chan struct{}
}

func NewStore() *Store {
	return &Store{
		data:   state{Tasks: make(map[string]*Task), Sessions: make(map[string]*Session)},
		events: make(map[string][]Event), changed: make(map[string]chan struct{}),
	}
}

// Create preserves the one-shot API; CreateTurn continues an explicit session.
func (s *Store) Create(prompt, vncViewURL string) (*Task, error) {
	return s.CreateTurn("", prompt, vncViewURL)
}

func (s *Store) CreateTurn(sessionID, prompt, vncViewURL string) (*Task, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, ErrInvalidPrompt
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	var session *Session
	if sessionID == "" {
		title := []rune(strings.Join(strings.Fields(prompt), " "))
		if len(title) > 80 {
			title = append(title[:80], '…')
		}
		session = &Session{ID: newID(), Title: string(title), CreatedAt: now}
	} else {
		stored, ok := s.data.Sessions[sessionID]
		if !ok {
			return nil, ErrNotFound
		}
		if stored.ActiveTaskID != "" {
			return nil, ErrSessionBusy
		}
		session = cloneSession(stored)
	}
	t := &Task{
		ID: newID(), SessionID: session.ID, ThreadID: session.ThreadID,
		Prompt: prompt, Status: StatusQueued, Runner: RunnerCodex,
		CreatedAt: now, UpdatedAt: now, VNCViewURL: vncViewURL, EventID: 1,
	}
	session.ActiveTaskID, session.Status, session.UpdatedAt = t.ID, t.Status, now
	session.Messages = append(session.Messages, Message{
		ID: t.ID + ":user", TaskID: t.ID, Role: "user", Content: prompt, CreatedAt: now,
	})
	if err := s.commit(t, session, true); err != nil {
		return nil, err
	}
	s.publish(t.ID, Event{ID: 1, Type: "status", Status: t.Status, Message: "queued", Timestamp: now})
	return clone(t), nil
}

func (s *Store) Get(id string) (*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.data.Tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	return clone(t), nil
}

func (s *Store) List(limit int) []*Task {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Task, 0)
	for i := len(s.data.Order) - 1; i >= 0; i-- {
		out = append(out, clone(s.data.Tasks[s.data.Order[i]]))
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func (s *Store) ListSessions() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Session, 0, len(s.data.Sessions))
	for _, session := range s.data.Sessions {
		c := *session
		c.Messages = nil
		out = append(out, &c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

// Session returns history and turns from the same snapshot.
func (s *Store) Session(id string) (*Session, []*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.data.Sessions[id]
	if !ok {
		return nil, nil, ErrNotFound
	}
	tasks := make([]*Task, 0)
	for _, taskID := range s.data.Order {
		if t := s.data.Tasks[taskID]; t.SessionID == id {
			tasks = append(tasks, clone(t))
		}
	}
	return cloneSession(session), tasks, nil
}

func (s *Store) UpdateStatus(id string, status Status, errMsg string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.data.Tasks[id]
	if !ok {
		return nil, ErrNotFound
	}
	if stored.Status.Terminal() {
		return nil, ErrInvalidTransition
	}
	t := clone(stored)
	t.Status, t.UpdatedAt, t.EventID = status, time.Now().UTC(), t.EventID+1
	t.Error = nil
	if errMsg != "" {
		t.Error = &errMsg
	}
	session := cloneSession(s.data.Sessions[t.SessionID])
	session.Status, session.UpdatedAt = status, t.UpdatedAt
	if status.Terminal() {
		session.ActiveTaskID = ""
	}
	if err := s.commit(t, session, false); err != nil {
		return nil, err
	}
	ev := Event{ID: t.EventID, Type: "status", Status: status, Message: string(status), Timestamp: t.UpdatedAt}
	if errMsg != "" {
		ev.Message = errMsg
	}
	s.publish(id, ev)
	return clone(t), nil
}

// AppendEvent persists native thread handles and assistant messages before delivery.
func (s *Store) AppendEvent(id string, ev Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.data.Tasks[id]
	if !ok {
		return ErrNotFound
	}
	if stored.Status.Terminal() {
		return ErrInvalidTransition
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	t := clone(stored)
	t.UpdatedAt, t.EventID = ev.Timestamp, t.EventID+1
	ev.ID = t.EventID
	if ev.Type == "thread" || ev.Type == "message" {
		session := cloneSession(s.data.Sessions[t.SessionID])
		session.UpdatedAt = ev.Timestamp
		if ev.Type == "thread" {
			if ev.ThreadID == "" || (session.ThreadID != "" && session.ThreadID != ev.ThreadID) {
				return errors.New("runner returned an unexpected thread ID")
			}
			session.ThreadID, t.ThreadID = ev.ThreadID, ev.ThreadID
		} else {
			if ev.MessageID == "" {
				return errors.New("assistant message ID is required")
			}
			messageID := t.ID + ":" + ev.MessageID
			found := false
			for i := range session.Messages {
				if session.Messages[i].ID == messageID {
					session.Messages[i].Content = ev.Message
					found = true
					break
				}
			}
			if !found {
				session.Messages = append(session.Messages, Message{
					ID: messageID, TaskID: t.ID, Role: "assistant", Content: ev.Message, CreatedAt: ev.Timestamp,
				})
			}
		}
		if err := s.commit(t, session, false); err != nil {
			return err
		}
	} else {
		// shortcut: debug logs are memory-only; persist a log journal if restart-time diagnostics are needed.
		s.data.Tasks[id] = t
	}
	s.publish(id, ev)
	return nil
}

// Watch atomically reads the backlog and obtains a wake-up for the next append.
// Slow clients read from the store, so a full channel cannot discard replies.
func (s *Store) Watch(id string, after int64) ([]Event, bool, <-chan struct{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.data.Tasks[id]
	if !ok {
		return nil, false, nil, ErrNotFound
	}
	events := s.events[id]
	start := sort.Search(len(events), func(i int) bool { return events[i].ID > after })
	out := append([]Event(nil), events[start:]...)
	if s.changed[id] == nil {
		s.changed[id] = make(chan struct{})
	}
	return out, t.Status.Terminal(), s.changed[id], nil
}

func (s *Store) Events(id string) ([]Event, error) {
	events, _, _, err := s.Watch(id, 0)
	return events, err
}

func (s *Store) CanCancel(id string) (*Task, error) {
	t, err := s.Get(id)
	if err == nil && t.Status.Terminal() {
		err = ErrNotCancellable
	}
	return t, err
}

// commit publishes a new snapshot only after its atomic disk write succeeds.
// Caller holds mu and passes copies of the objects it changed.
func (s *Store) commit(t *Task, session *Session, added bool) error {
	next := state{Tasks: maps.Clone(s.data.Tasks), Sessions: maps.Clone(s.data.Sessions), Order: s.data.Order}
	next.Tasks[t.ID], next.Sessions[session.ID] = t, session
	if added {
		next.Order = append(append([]string(nil), s.data.Order...), t.ID)
	}
	if err := s.save(next); err != nil {
		return fmt.Errorf("save conversation: %w", err)
	}
	s.data = next
	return nil
}

func (s *Store) publish(id string, ev Event) {
	s.events[id] = append(s.events[id], ev)
	if ch := s.changed[id]; ch != nil {
		close(ch)
	}
	s.changed[id] = make(chan struct{})
}

func clone(t *Task) *Task {
	c := *t
	if t.Error != nil {
		e := *t.Error
		c.Error = &e
	}
	return &c
}

func cloneSession(session *Session) *Session {
	c := *session
	c.Messages = append([]Message(nil), session.Messages...)
	return &c
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate ID: %v", err))
	}
	return hex.EncodeToString(b[:])
}
