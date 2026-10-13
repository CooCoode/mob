package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/runner"
	"github.com/xrdavies/mob/internal/task"
)

type Server struct {
	cfg    config.Config
	store  *task.Store
	runner runner.Runner

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
	closing bool
	runs    sync.WaitGroup
}

func New(cfg config.Config, store *task.Store, r runner.Runner) *Server {
	return &Server{cfg: cfg, store: store, runner: r, cancels: make(map[string]context.CancelFunc)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /sessions", s.handleListSessions)
	mux.HandleFunc("GET /sessions/{id}", s.handleGetSession)
	mux.HandleFunc("POST /tasks", s.withAuth(s.handleCreateTask))
	mux.HandleFunc("GET /tasks", s.handleListTasks)
	mux.HandleFunc("GET /tasks/{id}", s.handleGetTask)
	mux.HandleFunc("GET /tasks/{id}/events", s.handleTaskEvents)
	mux.HandleFunc("POST /tasks/{id}/cancel", s.withAuth(s.handleCancelTask))
	mux.HandleFunc("GET /queue", s.handleQueue)
	return s.withCORS(mux)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(s.cfg.CORSOrigins))
	for _, origin := range s.cfg.CORSOrigins {
		allowed[origin] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if _, ok := allowed[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mob-Token")
		}
		if r.Method == http.MethodOptions {
			if origin == "" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if _, ok := allowed[origin]; !ok {
				writeErr(w, http.StatusForbidden, "origin not allowed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "service": "mobd", "apiVersion": 2,
		"vncViewUrl": s.cfg.VNCViewURL, "runner": task.RunnerCodex, "mobMcp": s.cfg.MobMCPCommand,
	})
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req task.CreateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body (maximum 1 MiB)")
		return
	}
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		writeErr(w, http.StatusServiceUnavailable, "mobd is stopping")
		return
	}
	t, err := s.store.CreateTurn(req.SessionID, req.Prompt, s.cfg.VNCViewURL)
	if err != nil {
		s.mu.Unlock()
		code := http.StatusInternalServerError
		switch {
		case errors.Is(err, task.ErrInvalidPrompt):
			code = http.StatusBadRequest
		case errors.Is(err, task.ErrNotFound):
			code = http.StatusNotFound
		case errors.Is(err, task.ErrSessionBusy):
			code = http.StatusConflict
		}
		writeErr(w, code, err.Error())
		return
	}
	s.scheduleLocked()
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, t)
}

// scheduleLocked starts queued turns in FIFO order while desktop slots are free.
// A dispatched task has a cancel func even before it reports running. Caller holds mu.
func (s *Server) scheduleLocked() {
	limit := max(s.cfg.MaxRunning, 1)
	for !s.closing && len(s.cancels) < limit {
		next := s.store.NextQueued(func(id string) bool { return s.cancels[id] != nil })
		if next == nil {
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		s.cancels[next.ID] = cancel
		s.runs.Add(1)
		go s.runTask(ctx, next.ID)
	}
}

func (s *Server) handleQueue(w http.ResponseWriter, r *http.Request) {
	running, queued := s.store.Queue()
	writeJSON(w, http.StatusOK, map[string]any{"running": running, "queued": queued})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.store.ListSessions()})
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, tasks, activities, err := s.store.Session(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "tasks": tasks, "activities": activities})
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tasks": s.store.List(100)})
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleCancelTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	t, err := s.store.CanCancel(id)
	if err == nil {
		if cancel := s.cancels[id]; cancel != nil {
			cancel()
		} else {
			// Still waiting for the desktop: nothing to stop, finish it now.
			t, err = s.store.UpdateStatus(id, task.StatusCancelled, "cancelled")
		}
	}
	s.mu.Unlock()
	if err != nil {
		code := http.StatusConflict
		if errors.Is(err, task.ErrNotFound) {
			code = http.StatusNotFound
		}
		writeErr(w, code, err.Error())
		return
	}
	// Keep the session busy until the process and its output readers have stopped.
	writeJSON(w, http.StatusAccepted, t)
}

func (s *Server) handleTaskEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.Get(id); err != nil {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	cursor := r.Header.Get("Last-Event-ID")
	if cursor == "" {
		cursor = r.URL.Query().Get("after")
	}
	var after int64
	if cursor != "" {
		var err error
		after, err = strconv.ParseInt(cursor, 10, 64)
		if err != nil || after < 0 {
			writeErr(w, http.StatusBadRequest, "invalid event cursor")
			return
		}
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		past, terminal, changed, err := s.store.Watch(id, after)
		if err != nil {
			return
		}
		for _, ev := range past {
			if err := writeSSE(w, ev); err != nil {
				return
			}
			after = ev.ID
			flusher.Flush()
		}
		if terminal {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-changed:
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) runTask(ctx context.Context, id string) {
	defer func() {
		s.mu.Lock()
		s.cancels[id]()
		delete(s.cancels, id)
		s.scheduleLocked()
		s.mu.Unlock()
		s.runs.Done()
	}()
	t, err := s.store.UpdateStatus(id, task.StatusRunning, "")
	if err == nil {
		err = s.runner.Start(ctx, t, runner.Options{}, func(ev task.Event) error { return s.store.AppendEvent(id, ev) })
	}
	status, message := task.StatusSucceeded, ""
	if ctx.Err() != nil {
		status, message = task.StatusCancelled, "cancelled"
	} else if err != nil {
		status, message = task.StatusFailed, err.Error()
	}
	if _, err := s.store.UpdateStatus(id, status, message); err != nil {
		log.Printf("finish task %s: %v", id, err)
		if emitErr := s.store.AppendEvent(id, task.Event{Type: "error", Message: err.Error()}); emitErr != nil {
			log.Printf("report task %s failure: %v", id, emitErr)
		}
	}
}

// Close cancels active turns and waits for their final state to be saved.
func (s *Server) Close() {
	s.mu.Lock()
	s.closing = true
	for _, cancel := range s.cancels {
		cancel()
	}
	s.mu.Unlock()
	s.runs.Wait()
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

func writeSSE(w http.ResponseWriter, ev task.Event) error {
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Type, b)
	return err
}
