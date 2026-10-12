package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/runner/codex"
	"github.com/xrdavies/mob/internal/task"
)

// Server is the Phase 1 HTTP task API.
type Server struct {
	cfg    config.Config
	store  *task.Store
	runner *codex.Runner

	mu          sync.Mutex
	subscribers map[string]map[chan task.Event]struct{}
}

// New constructs the API server.
func New(cfg config.Config, store *task.Store, runner *codex.Runner) *Server {
	return &Server{
		cfg:         cfg,
		store:       store,
		runner:      runner,
		subscribers: make(map[string]map[chan task.Event]struct{}),
	}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /tasks", s.withAuth(s.handleCreateTask))
	mux.HandleFunc("GET /tasks", s.handleListTasks)
	mux.HandleFunc("GET /tasks/{id}", s.handleGetTask)
	mux.HandleFunc("GET /tasks/{id}/events", s.handleTaskEvents)
	mux.HandleFunc("POST /tasks/{id}/cancel", s.withAuth(s.handleCancelTask))
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"service":    "mobd",
		"vncViewUrl": s.cfg.VNCViewURL,
		"runner":     task.RunnerCodex,
		"mobMcp":     s.cfg.MobMCPCommand,
	})
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req task.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	t, err := s.store.Create(req.Prompt, s.cfg.VNCViewURL)
	if err != nil {
		if errors.Is(err, task.ErrInvalidPrompt) {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	go s.runTask(t.ID)
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tasks": s.store.List(100)})
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := s.store.Get(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleCancelTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := s.store.CanCancel(id)
	if err != nil {
		if errors.Is(err, task.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "task not found")
			return
		}
		if errors.Is(err, task.ErrNotCancellable) {
			writeErr(w, http.StatusConflict, "task is not cancellable")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = s.runner.Cancel(id)
	updated, _ := s.store.UpdateStatus(id, task.StatusCancelled, "cancelled by client")
	s.broadcast(id, task.Event{
		Type:      "status",
		Status:    task.StatusCancelled,
		Message:   "cancelled by client",
		Timestamp: time.Now().UTC(),
	})
	if updated != nil {
		t = updated
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleTaskEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.Get(id); err != nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Replay existing events.
	past, _ := s.store.Events(id)
	terminal := false
	for _, ev := range past {
		writeSSE(w, ev)
		flusher.Flush()
		if ev.Status == task.StatusSucceeded || ev.Status == task.StatusFailed || ev.Status == task.StatusCancelled {
			terminal = true
		}
	}
	if terminal {
		return
	}
	// Also stop if store already shows a terminal status (event shape may vary).
	if cur, err := s.store.Get(id); err == nil {
		switch cur.Status {
		case task.StatusSucceeded, task.StatusFailed, task.StatusCancelled:
			return
		}
	}

	ch := make(chan task.Event, 32)
	s.subscribe(id, ch)
	defer s.unsubscribe(id, ch)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, ev)
			flusher.Flush()
			if ev.Status == task.StatusSucceeded || ev.Status == task.StatusFailed || ev.Status == task.StatusCancelled {
				// Allow a brief moment then end stream for terminal states.
				return
			}
		}
	}
}

func (s *Server) runTask(id string) {
	t, err := s.store.Get(id)
	if err != nil {
		return
	}
	if _, err := s.store.UpdateStatus(id, task.StatusRunning, ""); err != nil {
		return
	}
	s.broadcast(id, task.Event{
		Type:      "status",
		Status:    task.StatusRunning,
		Message:   "running",
		Timestamp: time.Now().UTC(),
	})

	emit := func(ev task.Event) {
		if ev.Timestamp.IsZero() {
			ev.Timestamp = time.Now().UTC()
		}
		_ = s.store.AppendEvent(id, ev)
		s.broadcast(id, ev)
	}

	ctx := context.Background()
	err = s.runner.Start(ctx, t, emit)

	// If client already cancelled, leave cancelled.
	cur, getErr := s.store.Get(id)
	if getErr == nil && cur.Status == task.StatusCancelled {
		return
	}

	if err != nil {
		if errors.Is(err, context.Canceled) {
			_, _ = s.store.UpdateStatus(id, task.StatusCancelled, "cancelled")
			s.broadcast(id, task.Event{Type: "status", Status: task.StatusCancelled, Message: "cancelled", Timestamp: time.Now().UTC()})
			return
		}
		msg := err.Error()
		_, _ = s.store.UpdateStatus(id, task.StatusFailed, msg)
		s.broadcast(id, task.Event{Type: "status", Status: task.StatusFailed, Message: msg, Timestamp: time.Now().UTC()})
		return
	}
	_, _ = s.store.UpdateStatus(id, task.StatusSucceeded, "")
	s.broadcast(id, task.Event{Type: "status", Status: task.StatusSucceeded, Message: "succeeded", Timestamp: time.Now().UTC()})
}

func (s *Server) subscribe(id string, ch chan task.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.subscribers[id] == nil {
		s.subscribers[id] = make(map[chan task.Event]struct{})
	}
	s.subscribers[id][ch] = struct{}{}
}

func (s *Server) unsubscribe(id string, ch chan task.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if m, ok := s.subscribers[id]; ok {
		delete(m, ch)
		close(ch)
		if len(m) == 0 {
			delete(s.subscribers, id)
		}
	}
}

func (s *Server) broadcast(id string, ev task.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subscribers[id] {
		select {
		case ch <- ev:
		default:
			// drop if slow consumer
		}
	}
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secret := s.cfg.SharedSecret
		if secret == "" {
			next(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		got := strings.TrimPrefix(auth, "Bearer ")
		if got == auth {
			got = r.Header.Get("X-Mob-Token")
		}
		if got != secret {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeSSE(w http.ResponseWriter, ev task.Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b)
}
