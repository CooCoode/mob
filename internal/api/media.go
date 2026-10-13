package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"time"

	"github.com/xrdavies/mob/internal/actuate"
	"github.com/xrdavies/mob/internal/artifact"
	"github.com/xrdavies/mob/internal/runner"
	"github.com/xrdavies/mob/internal/task"
)

const maxUpload = 20 << 20

// Efforts are the Codex reasoning efforts clients may request.
var Efforts = []string{"minimal", "low", "medium", "high", "xhigh"}

var validModel = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

// capture is swapped in tests; it returns a PNG of the office desktop.
var capture = actuate.Capture

func (s *Server) handleScreen(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	format := q.Get("format")
	if format == "" {
		format = "jpeg"
	}
	maxWidth, quality := 0, 80
	var err error
	if raw := q.Get("maxWidth"); raw != "" {
		if maxWidth, err = strconv.Atoi(raw); err != nil || maxWidth < 16 || maxWidth > 8192 {
			writeErr(w, http.StatusBadRequest, "maxWidth must be 16-8192")
			return
		}
	}
	if raw := q.Get("quality"); raw != "" {
		if quality, err = strconv.Atoi(raw); err != nil || quality < 1 || quality > 100 {
			writeErr(w, http.StatusBadRequest, "quality must be 1-100")
			return
		}
	}
	if format != "jpeg" && format != "png" {
		writeErr(w, http.StatusBadRequest, "format must be jpeg or png")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	png, err := capture(ctx)
	if errors.Is(err, actuate.ErrUnsupported) {
		writeErr(w, http.StatusNotImplemented, err.Error())
		return
	}
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	out, mime, err := actuate.Encode(png, format, maxWidth, quality)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(out)))
	_, _ = w.Write(out)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "multipart field \"file\" is required (maximum 20 MiB)")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxUpload+1))
	if err != nil || len(data) > maxUpload {
		writeErr(w, http.StatusRequestEntityTooLarge, "file exceeds 20 MiB")
		return
	}
	mime := http.DetectContentType(data)
	if !artifact.Supported(mime) {
		writeErr(w, http.StatusUnsupportedMediaType, "only PNG, JPEG, GIF and WebP images are supported")
		return
	}
	id, err := s.artifacts.Save(mime, data)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "name": header.Filename, "mime": mime, "size": len(data), "url": "/artifacts/" + id,
	})
}

func (s *Server) handleArtifact(w http.ResponseWriter, r *http.Request) {
	path, mime, err := s.artifacts.Path(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "artifact not found")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "artifact not found")
		return
	}
	defer f.Close()
	info, _ := f.Stat()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// turnOptions validates per-turn settings from POST /tasks.
func (s *Server) turnOptions(req task.CreateRequest) (task.TurnOptions, string) {
	opts := task.TurnOptions{Model: req.Model, Effort: req.Effort, Attachments: req.Attachments}
	if opts.Model != "" && !validModel.MatchString(opts.Model) {
		return opts, "invalid model"
	}
	if opts.Effort != "" {
		ok := false
		for _, e := range Efforts {
			ok = ok || e == opts.Effort
		}
		if !ok {
			return opts, "effort must be one of minimal, low, medium, high, xhigh"
		}
	}
	if len(opts.Attachments) > 10 {
		return opts, "at most 10 attachments"
	}
	for _, id := range opts.Attachments {
		if _, _, err := s.artifacts.Path(id); err != nil {
			return opts, "unknown attachment " + strconv.Quote(id)
		}
	}
	return opts, ""
}

// runOptions resolves attachments to files and lets the runner save screenshots.
func (s *Server) runOptions(t *task.Task) runner.Options {
	opts := runner.Options{SaveImage: s.artifacts.Save}
	for _, id := range t.Attachments {
		if path, _, err := s.artifacts.Path(id); err == nil {
			opts.Images = append(opts.Images, path)
		}
	}
	return opts
}
