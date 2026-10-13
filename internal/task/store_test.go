package task

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestCreateGetList(t *testing.T) {
	s := NewStore()
	a, err := s.Create("do thing", "https://vnc.example/")
	if err != nil {
		t.Fatal(err)
	}
	if a.Status != StatusQueued || a.Runner != RunnerCodex {
		t.Fatalf("unexpected task: %+v", a)
	}
	if a.VNCViewURL != "https://vnc.example/" {
		t.Fatalf("vnc url: %q", a.VNCViewURL)
	}
	got, err := s.Get(a.ID)
	if err != nil || got.Prompt != "do thing" {
		t.Fatalf("get: %+v %v", got, err)
	}
	b, _ := s.Create("second", "")
	list := s.List(10)
	if len(list) != 2 || list[0].ID != b.ID {
		t.Fatalf("list newest-first: %+v", list)
	}
}

func TestCreateEmptyPrompt(t *testing.T) {
	s := NewStore()
	if _, err := s.Create("   ", ""); err != ErrInvalidPrompt {
		t.Fatalf("want ErrInvalidPrompt, got %v", err)
	}
}

func TestUpdateStatusAndEvents(t *testing.T) {
	s := NewStore()
	tk, _ := s.Create("x", "")
	if _, err := s.UpdateStatus(tk.ID, StatusRunning, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateStatus(tk.ID, StatusFailed, "boom"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(tk.ID)
	if got.Status != StatusFailed || got.Error == nil || *got.Error != "boom" {
		t.Fatalf("got %+v", got)
	}
	evs, err := s.Events(tk.ID)
	if err != nil || len(evs) < 3 {
		t.Fatalf("events: %v len=%d", err, len(evs))
	}
}

func TestCanCancel(t *testing.T) {
	s := NewStore()
	tk, _ := s.Create("x", "")
	if _, err := s.CanCancel(tk.ID); err != nil {
		t.Fatal(err)
	}
	_, _ = s.UpdateStatus(tk.ID, StatusSucceeded, "")
	if _, err := s.CanCancel(tk.ID); err != ErrNotCancellable {
		t.Fatalf("want not cancellable, got %v", err)
	}
	if _, err := s.CanCancel("missing"); err != ErrNotFound {
		t.Fatalf("want not found, got %v", err)
	}
}

func TestGetMissing(t *testing.T) {
	s := NewStore()
	if _, err := s.Get("nope"); err != ErrNotFound {
		t.Fatalf("got %v", err)
	}
}

func TestSessionContinuationAndIsolation(t *testing.T) {
	s := NewStore()
	first, _ := s.Create("Remember 蓝鲸", "")
	if _, err := s.CreateTurn(first.SessionID, "too soon", ""); !errors.Is(err, ErrSessionBusy) {
		t.Fatalf("must serialize turns: %v", err)
	}
	if err := s.AppendEvent(first.ID, Event{Type: "thread", ThreadID: "thread-one"}); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"initial", "remembered 蓝鲸"} {
		if err := s.AppendEvent(first.ID, Event{Type: "message", MessageID: "item-1", Message: text}); err != nil {
			t.Fatal(err)
		}
	}
	_, _ = s.UpdateStatus(first.ID, StatusSucceeded, "")
	second, err := s.CreateTurn(first.SessionID, "What did I say?", "")
	if err != nil || second.ThreadID != "thread-one" || second.SessionID != first.SessionID {
		t.Fatalf("continuation: %+v %v", second, err)
	}
	other, _ := s.Create("separate conversation", "")
	if other.SessionID == first.SessionID || other.ThreadID != "" {
		t.Fatalf("thread leaked into another session: %+v", other)
	}
	session, turns, err := s.Session(first.SessionID)
	if err != nil || len(turns) != 2 || len(session.Messages) != 3 || session.Messages[1].Content != "remembered 蓝鲸" {
		t.Fatalf("history: %+v turns=%d err=%v", session, len(turns), err)
	}
	session.Messages[0].Content = "mutated"
	fresh, _, _ := s.Session(first.SessionID)
	if fresh.Messages[0].Content != "Remember 蓝鲸" {
		t.Fatal("returned history must be a copy")
	}
	if err := s.AppendEvent(second.ID, Event{Type: "thread", ThreadID: "wrong-thread"}); err == nil {
		t.Fatal("must reject provider thread replacement")
	}
}

func TestOnlyOneConcurrentTurnPerSession(t *testing.T) {
	s := NewStore()
	first, _ := s.Create("first", "")
	_, _ = s.UpdateStatus(first.ID, StatusSucceeded, "")
	var wg sync.WaitGroup
	results := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.CreateTurn(first.SessionID, "next", "")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrSessionBusy) {
			t.Fatal(err)
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d turns", accepted)
	}
}

func TestRestartRestoresTranscriptAndInterruptsActiveTurn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := s.Create("first", "")
	_ = s.AppendEvent(first.ID, Event{Type: "thread", ThreadID: "thread-one"})
	_ = s.AppendEvent(first.ID, Event{Type: "message", MessageID: "item-1", Message: "answer"})
	_, _ = s.UpdateStatus(first.ID, StatusSucceeded, "")
	second, _ := s.CreateTurn(first.SessionID, "follow up", "")
	_, _ = s.UpdateStatus(second.ID, StatusRunning, "")
	restored, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	session, turns, _ := restored.Session(first.SessionID)
	if session.ThreadID != "thread-one" || session.ActiveTaskID != "" || len(session.Messages) != 3 || session.Messages[1].Content != "answer" {
		t.Fatalf("lost history: %+v", session)
	}
	if turns[1].Status != StatusFailed || turns[1].Error == nil {
		t.Fatalf("interrupted turn: %+v", turns[1])
	}
	next, err := restored.CreateTurn(session.ID, "continue after restart", "")
	if err != nil || next.ThreadID != "thread-one" {
		t.Fatalf("restart continuation: %+v %v", next, err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("history permissions: %v", info.Mode())
	}
}

func TestPersistenceFailureDoesNotAcknowledgeOrMutateHistory(t *testing.T) {
	s := NewStore()
	tk, _ := s.Create("first", "")
	before, _, _ := s.Session(tk.SessionID)
	s.path = filepath.Join(t.TempDir(), "not-a-directory", "state.json")
	if err := os.WriteFile(filepath.Dir(s.path), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendEvent(tk.ID, Event{Type: "message", MessageID: "item", Message: "unsaved"}); err == nil {
		t.Fatal("must propagate disk write failure")
	}
	after, _, _ := s.Session(tk.SessionID)
	if len(after.Messages) != len(before.Messages) {
		t.Fatal("failed commit changed history")
	}
	if _, err := s.UpdateStatus(tk.ID, StatusSucceeded, ""); err == nil {
		t.Fatal("must not mark a turn successful when saving fails")
	}
	if _, err := s.Create("unsaved new session", ""); err == nil || len(s.ListSessions()) != 1 {
		t.Fatal("failed create changed the session list")
	}
}

func TestRejectCorruptHistory(t *testing.T) {
	if _, err := OpenStore(""); err == nil {
		t.Fatal("persistent store must require a path")
	}
	path := filepath.Join(t.TempDir(), "state.json")
	for _, content := range []string{
		"invalid JSON",
		`{"tasks":{},"sessions":{"bad":null}}`,
		`{"tasks":{"missing":{}},"sessions":{}}`,
		`{"tasks":{"t":{"id":"t","sessionId":"s","eventId":1,"status":"unknown"}},"sessions":{"s":{"id":"s"}},"order":["t"]}`,
	} {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := OpenStore(path); err == nil {
			t.Fatalf("accepted corrupt history: %s", content)
		}
	}
}
