package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xrdavies/mob/internal/config"
	"github.com/xrdavies/mob/internal/runner/codex"
	"github.com/xrdavies/mob/internal/task"
)

func testServer(t *testing.T, secret string) *Server {
	t.Helper()
	cfg := config.Config{
		ListenAddr:    ":0",
		CodexBin:      "codex-does-not-exist-for-tests",
		CodexWorkDir:  t.TempDir(),
		MobMCPCommand: "mob-mcp",
		SharedSecret:  secret,
		VNCViewURL:    "https://office.example/view",
	}
	store := task.NewStore()
	runner := codex.New(cfg)
	s := New(cfg, store, runner)
	t.Cleanup(s.Close)
	return s
}

type replayWriter struct {
	*httptest.ResponseRecorder
	flushes int
	onFlush func(int)
}

func (w *replayWriter) Flush() {
	w.ResponseRecorder.Flush()
	w.flushes++
	w.onFlush(w.flushes)
}

func TestReplyArrivingDuringReplayIsNotLost(t *testing.T) {
	s := testServer(t, "")
	tk, _ := s.store.Create("reply during replay", "")
	w := &replayWriter{ResponseRecorder: httptest.NewRecorder()}
	w.onFlush = func(n int) {
		if n != 2 {
			return
		}
		// More events than the old subscriber buffer, while replay is flushing.
		for i := 0; i < 100; i++ {
			if err := s.store.AppendEvent(tk.ID, task.Event{Type: "log", Message: "progress"}); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.store.AppendEvent(tk.ID, task.Event{Type: "message", MessageID: "reply", Message: "reply at replay boundary"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.store.UpdateStatus(tk.ID, task.StatusSucceeded, ""); err != nil {
			t.Fatal(err)
		}
	}
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/tasks/"+tk.ID+"/events", nil))
	body := w.Body.String()
	if !strings.Contains(body, "reply at replay boundary") || strings.Count(body, "\ndata:") != 103 {
		t.Fatalf("lost events: %s", body)
	}
}

func TestEventCursorResumesWithoutDuplicates(t *testing.T) {
	s := testServer(t, "")
	tk, _ := s.store.Create("cursor", "")
	_ = s.store.AppendEvent(tk.ID, task.Event{Type: "message", MessageID: "reply", Message: "answer"})
	_, _ = s.store.UpdateStatus(tk.ID, task.StatusSucceeded, "")
	for _, tc := range []struct {
		query, header string
		want          int
	}{
		{"", "", 3}, {"?after=1", "", 2}, {"?after=0", "2", 1}, {"?after=3", "", 0},
	} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/tasks/"+tk.ID+"/events"+tc.query, nil)
		if tc.header != "" {
			req.Header.Set("Last-Event-ID", tc.header)
		}
		s.Handler().ServeHTTP(rr, req)
		if count := strings.Count(rr.Body.String(), "\ndata:"); count != tc.want {
			t.Fatalf("query=%s header=%s count=%d body=%s", tc.query, tc.header, count, rr.Body.String())
		}
	}
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/tasks/"+tk.ID+"/events?after=bad", nil))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid cursor: %d", rr.Code)
	}
}

func waitTask(t *testing.T, s *Server, id string) *task.Task {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		got, err := s.store.Get(id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status.Terminal() {
			return got
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("runner did not finish")
	return nil
}

func TestConversationUsesExplicitThreadAndSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-codex")
	script := `#!/bin/sh
n=0
if [ -f count ]; then n=$(cat count); fi
n=$((n + 1))
printf '%s' "$n" > count
printf '%s\n' "$@" > "args-$n"
cat > "prompt-$n"
thread="provider-$n"
reply='first reply'
case "$*" in
  *'resume -- provider-1 -'*) thread='provider-1'; reply='remembered 蓝鲸' ;;
esac
printf '{"type":"thread.started","thread_id":"%s"}\n' "$thread"
printf '{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"%s"}}\n' "$reply"
printf '%s\n' '{"type":"turn.completed"}'
`
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{CodexBin: bin, CodexWorkDir: dir, MobMCPCommand: "mob-mcp"}
	path := filepath.Join(dir, "state.json")
	store, err := task.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	s := New(cfg, store, codex.New(cfg))
	t.Cleanup(s.Close)
	post := func(server *Server, sessionID, prompt string) task.Task {
		t.Helper()
		body, _ := json.Marshal(task.CreateRequest{SessionID: sessionID, Prompt: prompt})
		rr := httptest.NewRecorder()
		server.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewReader(body)))
		if rr.Code != http.StatusCreated {
			t.Fatalf("post %d: %s", rr.Code, rr.Body.String())
		}
		var created task.Task
		if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		if got := waitTask(t, server, created.ID); got.Status != task.StatusSucceeded {
			t.Fatalf("turn failed: %+v", got)
		}
		return created
	}
	first := post(s, "", "Remember 蓝鲸")
	second := post(s, first.SessionID, "What did I say?")
	if first.SessionID != second.SessionID || second.ThreadID != "provider-1" {
		t.Fatal("session/thread changed")
	}
	args, _ := os.ReadFile(filepath.Join(dir, "args-2"))
	if !strings.Contains(string(args), "resume\n--\nprovider-1\n-\n") {
		t.Fatalf("resume args: %s", args)
	}
	separate := post(s, "", "new conversation")
	if separate.SessionID == first.SessionID {
		t.Fatal("new chat reused the old session")
	}
	s.Close()
	restored, err := task.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	afterRestart := New(cfg, restored, codex.New(cfg))
	t.Cleanup(afterRestart.Close)
	rr := httptest.NewRecorder()
	afterRestart.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/sessions/"+first.SessionID, nil))
	var detail struct {
		Session task.Session `json:"session"`
		Tasks   []task.Task  `json:"tasks"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if len(detail.Tasks) != 2 || len(detail.Session.Messages) != 4 || detail.Session.Messages[3].Content != "remembered 蓝鲸" {
		t.Fatalf("incomplete restored history: %s", rr.Body.String())
	}
	post(afterRestart, first.SessionID, "continue after restart")
	rr = httptest.NewRecorder()
	afterRestart.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/sessions", nil))
	var list struct {
		Sessions []task.Session `json:"sessions"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Sessions) != 2 {
		t.Fatalf("every turn created a session: %s", rr.Body.String())
	}
}

func TestCancelDoesNotReleaseSessionBeforeRunnerStops(t *testing.T) {
	s := testServer(t, "")
	tk, _ := s.store.Create("busy", "")
	cancelled := false
	s.cancels[tk.ID] = func() { cancelled = true }
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/tasks/"+tk.ID+"/cancel", nil))
	if rr.Code != http.StatusAccepted || !cancelled {
		t.Fatalf("cancel: %d", rr.Code)
	}
	body, _ := json.Marshal(task.CreateRequest{SessionID: tk.SessionID, Prompt: "next"})
	rr = httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewReader(body)))
	if rr.Code != http.StatusConflict {
		t.Fatalf("overlapping turn accepted: %d %s", rr.Code, rr.Body.String())
	}
	_, _ = s.store.UpdateStatus(tk.ID, task.StatusCancelled, "cancelled")
	if _, err := s.store.CreateTurn(tk.SessionID, "after stop", ""); err != nil {
		t.Fatal(err)
	}
}

func TestHealth(t *testing.T) {
	s := testServer(t, "")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true || body["service"] != "mobd" {
		t.Fatalf("body %+v", body)
	}
}

func TestCreateListGetTask(t *testing.T) {
	s := testServer(t, "")
	h := s.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(`{"prompt":"open Safari"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var created task.Task
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Status != task.StatusQueued {
		t.Fatalf("created %+v", created)
	}
	if created.VNCViewURL != "https://office.example/view" {
		t.Fatalf("vnc %q", created.VNCViewURL)
	}

	// Wait briefly for stub runner to fail (missing codex).
	deadline := time.Now().Add(2 * time.Second)
	var got task.Task
	for time.Now().Before(deadline) {
		rr = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/tasks/"+created.ID, nil)
		h.ServeHTTP(rr, req)
		_ = json.Unmarshal(rr.Body.Bytes(), &got)
		if got.Status == task.StatusFailed || got.Status == task.StatusSucceeded {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got.Status != task.StatusFailed {
		t.Fatalf("expected failed stub, got %+v", got)
	}
	if got.Error == nil || !strings.Contains(*got.Error, "not found") {
		t.Fatalf("expected codex-not-found error, got %+v", got.Error)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/tasks", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list %d", rr.Code)
	}
}

func TestCreateRequiresPrompt(t *testing.T) {
	s := testServer(t, "")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(`{"prompt":""}`))
	req.Header.Set("Content-Type", "application/json")
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rr.Code)
	}
}

func TestAuthSharedSecret(t *testing.T) {
	s := testServer(t, "secret")
	h := s.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(`{"prompt":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(`{"prompt":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestGetMissing(t *testing.T) {
	s := testServer(t, "")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/tasks/does-not-exist", nil)
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d", rr.Code)
	}
}

func TestSSEReplay(t *testing.T) {
	s := testServer(t, "")
	h := s.Handler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(`{"prompt":"sse"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	var created task.Task
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	// Allow runner to finish stub failure so events exist.
	time.Sleep(50 * time.Millisecond)

	ctxRR := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/tasks/"+created.ID+"/events", nil)
	// Use a short-lived context via Cancel — httptest doesn't stream forever well;
	// handler returns on terminal status after replay+subscribe.
	done := make(chan struct{})
	go func() {
		h.ServeHTTP(ctxRR, req)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("SSE handler did not finish")
	}
	body := ctxRR.Body.String()
	if !strings.Contains(body, "event:") || !strings.Contains(body, "data:") {
		t.Fatalf("unexpected SSE body: %q", body)
	}
	if ctxRR.Code != http.StatusOK && ctxRR.Code != 0 {
		// httptest may leave code 200
	}
	if ct := ctxRR.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("content-type %q", ct)
	}
}
