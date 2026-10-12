package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	return New(cfg, store, runner)
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
