package api

import (
	"bufio"
	"bytes"
	"context"
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
		CORSOrigins:   []string{"http://localhost:1420"},
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

func TestCORSResponses(t *testing.T) {
	s := testServer(t, "")
	for _, tc := range []struct {
		name, path, origin, allowOrigin string
		status                          int
	}{
		{"health", "/health", "http://localhost:1420", "http://localhost:1420", http.StatusOK},
		{"error", "/tasks/missing", "http://localhost:1420", "http://localhost:1420", http.StatusNotFound},
		{"unknown origin", "/health", "https://untrusted.example", "", http.StatusOK},
		{"origin prefix", "/health", "http://localhost:1420.evil.example", "", http.StatusOK},
		{"no origin", "/health", "", "", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("Origin", tc.origin)
			s.Handler().ServeHTTP(rr, req)
			if rr.Code != tc.status || rr.Header().Get("Access-Control-Allow-Origin") != tc.allowOrigin {
				t.Fatalf("status=%d headers=%v", rr.Code, rr.Header())
			}
			if rr.Header().Get("Vary") != "Origin" {
				t.Fatalf("vary %q", rr.Header().Get("Vary"))
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	s := testServer(t, "secret")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/tasks", nil)
	req.Header.Set("Origin", "http://localhost:1420")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type, authorization, x-mob-token")
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:1420" ||
		!strings.Contains(rr.Header().Get("Access-Control-Allow-Methods"), "POST") {
		t.Fatalf("preflight headers %v", rr.Header())
	}
	for _, header := range []string{"Content-Type", "Authorization", "X-Mob-Token"} {
		if !strings.Contains(rr.Header().Get("Access-Control-Allow-Headers"), header) {
			t.Fatalf("missing allowed header %s", header)
		}
	}
}

func TestCORSRejectsUnknownPreflightOrigin(t *testing.T) {
	s := testServer(t, "")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/tasks", nil)
	req.Header.Set("Origin", "https://untrusted.example")
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected allow-origin: %v", rr.Header())
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
	req.Header.Set("Origin", "http://localhost:1420")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:1420" {
		t.Fatal("auth error missing CORS headers")
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
	req.Header.Set("Origin", "http://localhost:1420")
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
	if ctxRR.Header().Get("Access-Control-Allow-Origin") != "http://localhost:1420" {
		t.Fatal("SSE missing CORS headers")
	}
}

func fakeCodexServer(t *testing.T, script string) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-codex")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+script), 0700); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{CodexBin: bin, CodexWorkDir: dir, MobMCPCommand: "mob-mcp", MaxRunning: 1}
	s := New(cfg, task.NewStore(), codex.New(cfg))
	t.Cleanup(s.Close)
	return s, dir
}

const slowReply = `cat > /dev/null
echo run >> runs
sleep 0.4
printf '%s\n' '{"type":"thread.started","thread_id":"th"}' '{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"ok"}}' '{"type":"turn.completed"}'
`

func postTask(t *testing.T, s *Server, body string) task.Task {
	t.Helper()
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body)))
	if rr.Code != http.StatusCreated {
		t.Fatalf("post %d: %s", rr.Code, rr.Body.String())
	}
	var created task.Task
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created
}

func TestDesktopQueueRunsOneTaskAtATime(t *testing.T) {
	s, _ := fakeCodexServer(t, slowReply)
	first := postTask(t, s, `{"prompt":"first"}`)
	second := postTask(t, s, `{"prompt":"second"}`)
	if second.Status != task.StatusQueued || second.QueuePosition != 1 {
		t.Fatalf("second should wait behind first: %+v", second)
	}
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/queue", nil))
	var q struct{ Running, Queued []task.Task }
	_ = json.Unmarshal(rr.Body.Bytes(), &q)
	if len(q.Queued) != 1 || q.Queued[0].ID != second.ID || q.Queued[0].QueuePosition != 1 {
		t.Fatalf("queue: %s", rr.Body.String())
	}
	a, b := waitTask(t, s, first.ID), waitTask(t, s, second.ID)
	if a.Status != task.StatusSucceeded || b.Status != task.StatusSucceeded {
		t.Fatalf("statuses %s %s", a.Status, b.Status)
	}
	if b.StartedAt == nil || a.FinishedAt == nil || b.StartedAt.Before(*a.FinishedAt) {
		t.Fatalf("turns overlapped: first finished %v, second started %v", a.FinishedAt, b.StartedAt)
	}
}

func TestCancelQueuedTaskNeverStartsRunner(t *testing.T) {
	s, dir := fakeCodexServer(t, slowReply)
	first := postTask(t, s, `{"prompt":"first"}`)
	queued := postTask(t, s, `{"prompt":"queued"}`)
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/tasks/"+queued.ID+"/cancel", nil))
	if rr.Code != http.StatusAccepted {
		t.Fatalf("cancel %d %s", rr.Code, rr.Body.String())
	}
	if got, _ := s.store.Get(queued.ID); got.Status != task.StatusCancelled {
		t.Fatalf("queued task not cancelled immediately: %+v", got)
	}
	waitTask(t, s, first.ID)
	time.Sleep(100 * time.Millisecond)
	runs, _ := os.ReadFile(filepath.Join(dir, "runs"))
	if strings.Count(string(runs), "run") != 1 {
		t.Fatalf("cancelled queued task ran: %q", runs)
	}
	// The session is free again for a follow-up.
	postTask(t, s, `{"sessionId":"`+queued.SessionID+`","prompt":"retry"}`)
}

func doJSON(t *testing.T, s *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(method, path, bytes.NewBufferString(body)))
	return rr
}

func TestSessionAdmin(t *testing.T) {
	s := testServer(t, "")
	old, _ := s.store.Create("older", "")
	_, _ = s.store.UpdateStatus(old.ID, task.StatusSucceeded, "")
	recent, _ := s.store.Create("recent", "")
	_, _ = s.store.UpdateStatus(recent.ID, task.StatusSucceeded, "")
	busy, _ := s.store.Create("busy", "")

	if rr := doJSON(t, s, http.MethodPatch, "/sessions/"+old.SessionID, `{"title":"  Weekly   report ","pinned":true}`); rr.Code != http.StatusOK ||
		!strings.Contains(rr.Body.String(), `"title":"Weekly report"`) || !strings.Contains(rr.Body.String(), `"pinned":true`) {
		t.Fatalf("patch: %d %s", rr.Code, rr.Body.String())
	}
	if rr := doJSON(t, s, http.MethodPatch, "/sessions/"+old.SessionID, `{"title":"   "}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("blank title: %d", rr.Code)
	}
	if rr := doJSON(t, s, http.MethodPatch, "/sessions/missing", `{"pinned":true}`); rr.Code != http.StatusNotFound {
		t.Fatalf("missing: %d", rr.Code)
	}
	list := func(query string) []task.Session {
		var body struct{ Sessions []task.Session }
		_ = json.Unmarshal(doJSON(t, s, http.MethodGet, "/sessions"+query, "").Body.Bytes(), &body)
		return body.Sessions
	}
	if got := list(""); len(got) != 3 || got[0].ID != old.SessionID {
		t.Fatalf("pinned session not first: %+v", got)
	}
	doJSON(t, s, http.MethodPatch, "/sessions/"+recent.SessionID, `{"archived":true}`)
	if got := list(""); len(got) != 2 {
		t.Fatalf("archived listed by default: %+v", got)
	}
	if got := list("?archived=true"); len(got) != 1 || got[0].ID != recent.SessionID {
		t.Fatalf("archived filter: %+v", got)
	}
	if got := list("?archived=all"); len(got) != 3 {
		t.Fatalf("all filter: %+v", got)
	}
	if rr := doJSON(t, s, http.MethodGet, "/sessions?archived=maybe", ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad filter: %d", rr.Code)
	}

	if rr := doJSON(t, s, http.MethodDelete, "/sessions/"+busy.SessionID, ""); rr.Code != http.StatusConflict {
		t.Fatalf("deleted active session: %d", rr.Code)
	}
	if rr := doJSON(t, s, http.MethodDelete, "/sessions/"+old.SessionID, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rr.Code, rr.Body.String())
	}
	if rr := doJSON(t, s, http.MethodGet, "/tasks/"+old.ID, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("task of deleted session still served: %d", rr.Code)
	}
	if rr := doJSON(t, s, http.MethodGet, "/sessions/"+old.SessionID, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("deleted session still served: %d", rr.Code)
	}
}

func TestListTasksFilters(t *testing.T) {
	s := testServer(t, "")
	a, _ := s.store.Create("a", "")
	b, _ := s.store.Create("b", "")
	_, _ = s.store.UpdateStatus(b.ID, task.StatusSucceeded, "")
	list := func(query string) []task.Task {
		var body struct{ Tasks []task.Task }
		_ = json.Unmarshal(doJSON(t, s, http.MethodGet, "/tasks"+query, "").Body.Bytes(), &body)
		return body.Tasks
	}
	if got := list("?sessionId=" + a.SessionID); len(got) != 1 || got[0].ID != a.ID {
		t.Fatalf("session filter: %+v", got)
	}
	if got := list("?status=succeeded"); len(got) != 1 || got[0].ID != b.ID {
		t.Fatalf("status filter: %+v", got)
	}
	if got := list("?limit=1"); len(got) != 1 || got[0].ID != b.ID {
		t.Fatalf("limit: %+v", got)
	}
	if rr := doJSON(t, s, http.MethodGet, "/tasks?limit=0", ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad limit: %d", rr.Code)
	}
}

type sseEvent struct{ id, typ, data string }

// readSSE collects events until stop returns true or the deadline passes.
func readSSE(t *testing.T, url, lastID string, stop func([]sseEvent) bool) []sseEvent {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if lastID != "" {
		req.Header.Set("Last-Event-ID", lastID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := http.DefaultClient.Do(req.WithContext(ctx))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var events []sseEvent
	var cur sseEvent
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "id: "):
			cur.id = line[4:]
		case strings.HasPrefix(line, "event: "):
			cur.typ = line[7:]
		case strings.HasPrefix(line, "data: "):
			cur.data = line[6:]
		case line == "" && cur.typ != "":
			events = append(events, cur)
			cur = sseEvent{}
			if stop(events) {
				return events
			}
		}
	}
	t.Fatalf("stream ended early: %+v", events)
	return nil
}

func TestGlobalEventsStreamAndResume(t *testing.T) {
	s := testServer(t, "")
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)

	got := make(chan []sseEvent, 1)
	go func() {
		got <- readSSE(t, srv.URL+"/events", "", func(evs []sseEvent) bool {
			for _, ev := range evs {
				if ev.typ == "task" && strings.Contains(ev.data, `"status":"failed"`) {
					return true
				}
			}
			return false
		})
	}()
	time.Sleep(100 * time.Millisecond) // subscribe before the change
	created := postTask(t, s, `{"prompt":"live"}`)
	events := <-got
	types := map[string]bool{}
	for _, ev := range events {
		types[ev.typ] = true
	}
	if !types["session"] || !types["task"] || !types["queue"] || !strings.Contains(events[0].data, created.SessionID) {
		t.Fatalf("events: %+v", events)
	}

	// Resume after the first event replays the rest without duplicates.
	resumed := readSSE(t, srv.URL+"/events", events[0].id, func(evs []sseEvent) bool { return len(evs) == len(events)-1 })
	if resumed[0].id == events[0].id {
		t.Fatalf("duplicate on resume: %+v", resumed[0])
	}
	// A cursor from another process asks the client to refetch.
	reset := readSSE(t, srv.URL+"/events", "999999", func(evs []sseEvent) bool { return len(evs) == 1 })
	if reset[0].typ != "reset" {
		t.Fatalf("want reset, got %+v", reset)
	}

	doJSON(t, s, http.MethodDelete, "/sessions/"+created.SessionID, "")
	deleted := readSSE(t, srv.URL+"/events", events[len(events)-1].id, func(evs []sseEvent) bool {
		return evs[len(evs)-1].typ == "session.deleted"
	})
	if !strings.Contains(deleted[len(deleted)-1].data, created.SessionID) {
		t.Fatalf("delete event: %+v", deleted)
	}
}

func TestHubResetsEvictedCursor(t *testing.T) {
	h := newHub()
	for i := 0; i < hubSize+10; i++ {
		h.publish("task", i)
	}
	if _, reset, _, _ := h.since(5); !reset {
		t.Fatal("evicted cursor resumed")
	}
	events, reset, _, _ := h.since(h.cursor() - 2)
	if reset || len(events) != 2 {
		t.Fatalf("recent cursor: reset=%v n=%d", reset, len(events))
	}
}
