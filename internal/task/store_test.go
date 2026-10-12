package task

import (
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
