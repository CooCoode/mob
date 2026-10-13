package task

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
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
	session, turns, _, err := s.Session(first.SessionID)
	if err != nil || len(turns) != 2 || len(session.Messages) != 3 || session.Messages[1].Content != "remembered 蓝鲸" {
		t.Fatalf("history: %+v turns=%d err=%v", session, len(turns), err)
	}
	session.Messages[0].Content = "mutated"
	fresh, _, _, _ := s.Session(first.SessionID)
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
	for range 20 {
		wg.Go(func() {
			_, err := s.CreateTurn(first.SessionID, "next", "")
			results <- err
		})
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
	session, turns, _, _ := restored.Session(first.SessionID)
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
	before, _, _, _ := s.Session(tk.SessionID)
	s.path = filepath.Join(t.TempDir(), "not-a-directory", "state.json")
	if err := os.WriteFile(filepath.Dir(s.path), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendEvent(tk.ID, Event{Type: "message", MessageID: "item", Message: "unsaved"}); err == nil {
		t.Fatal("must propagate disk write failure")
	}
	after, _, _, _ := s.Session(tk.SessionID)
	if len(after.Messages) != len(before.Messages) {
		t.Fatal("failed commit changed history")
	}
	if _, err := s.UpdateStatus(tk.ID, StatusSucceeded, ""); err == nil {
		t.Fatal("must not mark a turn successful when saving fails")
	}
	if _, err := s.Create("unsaved new session", ""); err == nil || len(s.ListSessions(nil)) != 1 {
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

func TestActivitiesUpsertAndSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	tk, _ := s.Create("click", "")
	start := Activity{ID: "item_1", Kind: ActivityTool, Status: ActivityRunning, Title: "Screenshot", Images: nil}
	if err := s.AppendEvent(tk.ID, Event{Type: "activity", Activity: &start}); err != nil {
		t.Fatal(err)
	}
	done := Activity{ID: "item_1", Kind: ActivityTool, Status: ActivityCompleted, Title: "Screenshot",
		Images: []string{"img"}, Text: strings.Repeat("é", activityTextLimit)}
	if err := s.AppendEvent(tk.ID, Event{Type: "activity", Activity: &done}); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendEvent(tk.ID, Event{Type: "usage", Usage: &Usage{InputTokens: 7}}); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendEvent(tk.ID, Event{Type: "activity", Activity: &Activity{}}); err == nil {
		t.Fatal("activity without ID accepted")
	}
	restored, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	_, tasks, acts, err := restored.Session(tk.SessionID)
	if err != nil || len(acts) != 1 {
		t.Fatalf("activities=%+v err=%v", acts, err)
	}
	a := acts[0]
	if a.ID != "item_1" || a.TaskID != tk.ID || a.Status != ActivityCompleted || len(a.Images) != 1 || !a.Truncated ||
		len(a.Text) > activityTextLimit || !utf8.ValidString(a.Text) || a.StartedAt.After(a.UpdatedAt) {
		t.Fatalf("activity %+v", a)
	}
	if tasks[0].Usage == nil || tasks[0].Usage.InputTokens != 7 {
		t.Fatalf("usage not persisted: %+v", tasks[0])
	}
}

func TestDebugLogsAreCapped(t *testing.T) {
	s := NewStore()
	tk, _ := s.Create("chatty", "")
	for range logLimit + 50 {
		_ = s.AppendEvent(tk.ID, Event{Type: "log", Message: "line"})
	}
	_ = s.AppendEvent(tk.ID, Event{Type: "message", MessageID: "m", Message: "reply"})
	events, _ := s.Events(tk.ID)
	logs := 0
	for i, ev := range events {
		if ev.Type == "log" {
			logs++
		}
		if i > 0 && ev.ID <= events[i-1].ID {
			t.Fatal("event IDs not monotonic")
		}
	}
	if logs != logLimit || events[0].Type != "status" || events[len(events)-1].Message != "reply" {
		t.Fatalf("logs=%d first=%+v", logs, events[0])
	}
}
