import type {
  Activity, ChatMessage, Queue, Question, Session, SessionDetail, Task, TaskEvent, TaskStatus, TurnOptions,
} from "../api/types.ts";
import { authFetch, streamAuth, UnauthorizedError } from "./auth.ts";
import { EventStream, type StreamEvent, type StreamOptions } from "./sse.ts";

export type { Activity, ChatMessage, Question, Session, Task, TaskStatus };

const EVENT_TYPES = ["status", "message", "resume", "activity", "question", "usage", "log", "progress", "error"];

/** The part of EventStream the chat uses; tests substitute a fake. */
export interface ChatStream {
  addEventListener(type: string, listener: (ev: StreamEvent) => void): void;
  onerror: ((err?: unknown) => void) | null;
  close(): void;
}

export type StreamFactory = (url: string, options: StreamOptions) => ChatStream;

export function terminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/**
 * `d` applied to `base`: a full answer replaces it; a partial one (`full: false`) replaces only
 * the turns it carries, with their messages, steps and questions, and keeps the rest.
 */
export function mergeDetail(base: SessionDetail | null, d: SessionDetail): SessionDetail {
  if (d.full !== false || !base || base.session.id !== d.session.id) return d;
  const tasks = [...base.tasks];
  for (const t of d.tasks) {
    const i = tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) tasks[i] = t;
    else tasks.push(t);
  }
  const changed = new Set(d.tasks.map((t) => t.id));
  const known = new Set(tasks.map((t) => t.id));
  // Kept in turn order, so a changed older turn stays in its place.
  const pick = <T extends { taskId: string }>(old: T[] = [], fresh: T[] = []): T[] => {
    const byTurn = new Map<string, T[]>();
    for (const x of [...old.filter((x) => !changed.has(x.taskId)), ...fresh]) {
      byTurn.set(x.taskId, [...(byTurn.get(x.taskId) ?? []), x]);
    }
    return [...tasks.flatMap((t) => byTurn.get(t.id) ?? []), ...old.filter((x) => !known.has(x.taskId))];
  };
  return {
    session: { ...d.session, messages: pick(base.session.messages, d.session.messages) },
    tasks, activities: pick(base.activities, d.activities), questions: pick(base.questions, d.questions),
    rev: d.rev ?? base.rev, full: true,
  };
}

// Owns one visible conversation. Requests for a previous selection cannot replace it.
export class Chat {
  machineId = "";
  sessions: Session[] = [];
  sessionId: string | null = null;
  session: Session | null = null;
  tasks: Task[] = [];
  activities: Activity[] = [];
  questions: Question[] = [];
  ready = false;
  loading = false;
  submitting = false;
  cancelling = false;
  error = "";

  private url = "";
  private revision = 0;
  /** mobd's revision of the visible conversation; undefined from mobd versions without it. */
  private rev: number | undefined;
  /** Recently opened conversations on this machine, oldest first: reopening one shows it at once. */
  private cache = new Map<string, SessionDetail>();
  private source: ChatStream | null = null;
  private cursor = 0;
  private recovering: number | null = null;
  private changed: () => void;
  private log: (line: string) => void;
  private stream: StreamFactory;

  constructor(changed: () => void, log: (line: string) => void, stream: StreamFactory = (url, o) => new EventStream(url, o)) {
    this.changed = changed;
    this.log = log;
    this.stream = stream;
  }

  get baseUrl(): string {
    return this.url;
  }

  get currentTask(): Task | null {
    return this.tasks[this.tasks.length - 1] ?? null;
  }

  get busy(): boolean {
    return !!this.currentTask && !terminal(this.currentTask.status);
  }

  get canSend(): boolean {
    return this.ready && !this.loading && !this.submitting && !this.busy && !this.error;
  }

  async setMachine(id: string, url: string, saved?: string | null): Promise<void> {
    this.machineId = id;
    this.url = url.replace(/\/$/, "");
    this.sessions = [];
    this.ready = false;
    this.newChat();
    this.cache.clear();
    const revision = this.revision;
    this.loading = true;
    this.changed();
    try {
      await this.list(revision);
      if (revision !== this.revision) return;
      this.ready = true;
      this.loading = false;
      const selected = saved === null ? null :
        this.sessions.find((s) => s.id === saved)?.id ?? this.sessions[0]?.id;
      if (selected) await this.open(selected);
      else this.changed();
    } catch (err) {
      if (revision === this.revision) {
        this.loading = false;
        this.fail(err);
      }
    }
  }

  /** Leaves the machine: no requests until setMachine (e.g. while it needs pairing). */
  detach(): void {
    this.machineId = "";
    this.url = "";
    this.sessions = [];
    this.ready = false;
    this.newChat();
    this.cache.clear();
  }

  newChat(): void {
    this.remember();
    this.revision++;
    this.stop();
    this.cursor = 0;
    this.sessionId = null;
    this.session = null;
    this.rev = undefined;
    this.tasks = [];
    this.activities = [];
    this.questions = [];
    this.error = "";
    this.loading = false;
    this.cancelling = false;
    this.changed();
  }

  async open(id: string): Promise<void> {
    this.remember();
    const revision = ++this.revision;
    this.stop();
    this.cursor = 0;
    this.sessionId = id;
    this.session = null;
    this.rev = undefined;
    this.tasks = [];
    this.activities = [];
    this.questions = [];
    const cached = this.cache.get(id);
    if (cached) this.apply(cached);
    this.error = "";
    this.loading = !cached;
    this.cancelling = false;
    this.changed();
    try {
      const detail = mergeDetail(this.snapshot(), await this.detail(id, this.rev));
      if (revision !== this.revision) return;
      this.apply(detail);
      this.loading = false;
      this.changed();
      this.subscribe();
    } catch (err) {
      if (revision === this.revision) {
        this.loading = false;
        this.fail(err);
      }
    }
  }

  async refresh(): Promise<void> {
    const revision = this.revision;
    try {
      await this.list(revision);
      if (revision !== this.revision) return;
      this.ready = true;
      if (this.sessionId) await this.open(this.sessionId);
      else {
        this.error = "";
        this.changed();
      }
    } catch (err) {
      if (revision === this.revision) this.fail(err);
    }
  }

  async submit(prompt: string, options: TurnOptions = {}): Promise<boolean> {
    if (!this.canSend || !prompt.trim()) return false;
    const revision = ++this.revision;
    const url = this.url;
    const sessionId = this.sessionId;
    this.submitting = true;
    this.error = "";
    this.changed();
    try {
      const t = await this.request<Task>(`${url}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt, sessionId: sessionId ?? undefined, runner: sessionId ? undefined : options.runner || undefined,
          model: options.model || undefined,
          effort: options.effort || undefined, attachments: options.attachments?.length ? options.attachments : undefined,
        }),
      });
      if (!t.sessionId) throw new Error("Update office mobd to support chat sessions.");
      this.log(`created turn ${t.id} in session ${t.sessionId}`);
      if (revision !== this.revision) return false;
      this.sessionId = t.sessionId;
      this.session = {
        ...(this.session ?? { id: t.sessionId, title: prompt, status: t.status }),
        activeTaskId: t.id,
        status: t.status,
        messages: [...(this.session?.messages ?? []), {
          id: `${t.id}:user`, taskId: t.id, role: "user", content: prompt, createdAt: new Date().toISOString(),
        }],
      };
      this.tasks = [...this.tasks, t];
      const previous = this.sessions.find((s) => s.id === t.sessionId);
      this.sessions = [{ ...previous, id: t.sessionId, title: this.session.title, status: t.status, activeTaskId: t.id,
        updatedAt: t.createdAt ?? new Date().toISOString() }, ...this.sessions.filter((s) => s.id !== t.sessionId)];
      this.cursor = t.eventId;
      this.changed();
      this.subscribe();
      // The POST acknowledgement is enough to clear the composer; history recovers separately.
      void this.recover(revision);
      return true;
    } catch (err) {
      if (revision === this.revision) this.fail(err);
      return false;
    } finally {
      this.submitting = false;
      this.changed();
    }
  }

  async cancel(): Promise<void> {
    const t = this.currentTask;
    if (!t || !this.busy || this.cancelling) return;
    const revision = this.revision;
    this.cancelling = true;
    this.changed();
    try {
      await this.request(`${this.url}/tasks/${t.id}/cancel`, { method: "POST" });
      this.log(`cancel requested for ${t.id}`);
      // SSE releases the composer only when the runner has actually stopped.
    } catch (err) {
      if (revision === this.revision) {
        this.cancelling = false;
        this.fail(err);
      }
    }
  }

  /** Adds a message to the running turn (runners that support steering). */
  async steer(text: string): Promise<boolean> {
    const t = this.currentTask;
    if (!t || t.status !== "running" || !text.trim()) return false;
    try {
      await this.request(`${this.url}/tasks/${t.id}/steer`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }),
      });
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  /** Questions still waiting for the user, oldest first. */
  get pendingQuestions(): Question[] {
    return this.questions.filter((q) => q.status === "pending");
  }

  /** Sends the user's answer (or approval decision) for a pending question. */
  async answer(q: Question, reply: { answer?: string; approved?: boolean }): Promise<boolean> {
    try {
      const updated = await this.request<Question>(`${this.url}/tasks/${q.taskId}/questions/${q.id}/answer`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reply),
      });
      this.upsertQuestion(updated);
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  private upsertQuestion(q: Question): void {
    const i = this.questions.findIndex((x) => x.id === q.id);
    this.questions = i >= 0 ? this.questions.map((x, j) => (j === i ? q : x)) : [...this.questions, q];
    const waiting = this.questions.some((x) => x.taskId === q.taskId && x.status === "pending");
    const task = this.tasks.find((t) => t.id === q.taskId);
    if (task) task.waiting = waiting;
    if (this.session && this.currentTask?.id === q.taskId) this.session.waiting = waiting;
    const summary = this.sessions.find((s) => s.id === this.sessionId);
    if (summary && this.currentTask?.id === q.taskId) summary.waiting = waiting;
    this.changed();
  }

  /** Applies a session summary from the global event stream. */
  applySession(summary: Session): void {
    if (!this.ready) return;
    const existing = this.sessions.find((s) => s.id === summary.id);
    const merged = { ...existing, ...summary, messages: undefined };
    this.sessions = [merged, ...this.sessions.filter((s) => s.id !== summary.id)];
    if (this.session?.id === summary.id) {
      this.session = { ...this.session, title: summary.title, pinned: summary.pinned, archived: summary.archived, model: summary.model, effort: summary.effort };
    }
    this.changed();
  }

  removeSession(id: string): void {
    if (!this.sessions.some((s) => s.id === id) && this.sessionId !== id) return;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.sessionId === id) this.newChat();
    else this.changed();
    this.cache.delete(id);
  }

  /** Keeps the visible turn's queue position (and why it waits) current. */
  applyQueue(queue: Queue): void {
    const t = this.currentTask;
    if (!t || t.status !== "queued") return;
    const queued = queue.queued.find((q) => q.id === t.id);
    this.applyQueued(t, queued?.queuePosition, queued?.queueReason);
  }

  /** Applies a task snapshot from the global event stream to the visible queued turn. */
  applyTask(task: Task): void {
    const t = this.currentTask;
    if (!t || t.id !== task.id || t.status !== "queued" || task.status !== "queued") return;
    this.applyQueued(t, task.queuePosition, task.queueReason);
  }

  private applyQueued(t: Task, position: Task["queuePosition"], reason: Task["queueReason"]): void {
    if (position === t.queuePosition && reason === t.queueReason) return;
    t.queuePosition = position;
    t.queueReason = reason;
    this.changed();
  }

  async patchSession(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean; model?: string; effort?: string }): Promise<void> {
    try {
      const summary = await this.request<Session>(`${this.url}/sessions/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (summary.archived) this.removeSession(id);
      else this.applySession(summary);
    } catch (err) {
      this.fail(err);
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await this.request(`${this.url}/sessions/${id}`, { method: "DELETE" });
      this.removeSession(id);
    } catch (err) {
      this.fail(err);
    }
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await authFetch(this.url, url, init);
    if (res.status === 404 && url.endsWith("/sessions")) {
      throw new Error("Update office mobd to support chat sessions.");
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as T;
  }

  private async list(revision: number): Promise<void> {
    const data = await this.request<{ sessions: Session[] }>(`${this.url}/sessions`);
    if (!Array.isArray(data.sessions)) throw new Error("Invalid session list from mobd.");
    if (revision === this.revision) {
      this.sessions = data.sessions;
      this.changed();
    }
  }

  /** With `since`, mobd may answer only the turns changed after that revision (see mergeDetail). */
  private async detail(id: string, since?: number): Promise<SessionDetail> {
    const query = since ? `?since=${since}` : "";
    const data = await this.request<SessionDetail>(`${this.url}/sessions/${id}${query}`);
    if (data.session?.id !== id || !Array.isArray(data.tasks)) {
      throw new Error("Invalid session history from mobd.");
    }
    return data;
  }

  private apply(detail: SessionDetail): void {
    this.session = detail.session;
    this.tasks = detail.tasks;
    this.activities = detail.activities ?? [];
    this.questions = detail.questions ?? [];
    this.rev = detail.rev;
    this.cursor = this.currentTask?.eventId ?? 0;
    if (!this.busy) this.cancelling = false;
  }

  private subscribe(): void {
    const t = this.currentTask;
    if (!t || terminal(t.status)) return;
    this.stop();
    const revision = this.revision;
    const auth = streamAuth(this.url);
    const es = this.stream(`${this.url}/tasks/${t.id}/events?after=${this.cursor}`, {
      ...auth,
      // The reconnect resumes after the last event ID, like Last-Event-ID.
      resumeParam: "after",
      onUnauthorized: () => {
        auth.onUnauthorized();
        if (current()) {
          this.stop();
          this.fail(new UnauthorizedError());
        }
      },
    });
    this.source = es;
    const current = () => this.source === es && this.revision === revision;
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev) => {
        if (!current()) return;
        if (!ev.data) return;
        try {
          const data = JSON.parse(ev.data) as TaskEvent;
          if (!Number.isSafeInteger(data.id) || data.id <= this.cursor) return;
          const task = this.currentTask;
          if (!task || task.id !== t.id) return;
          this.cursor = data.id;
          task.eventId = data.id;
          this.log(`${type}: ${data.message ?? data.status ?? data.activity?.title ?? ""}`);
          if (type === "activity" && data.activity) {
            const a = data.activity;
            const i = this.activities.findIndex((x) => x.id === a.id);
            this.activities = i >= 0 ? this.activities.map((x, j) => (j === i ? a : x)) : [...this.activities, a];
            this.changed();
          }
          if (type === "question" && data.question) {
            this.upsertQuestion(data.question);
          }
          if (type === "usage" && data.usage) {
            task.usage = data.usage;
            this.changed();
          }
          if (type === "message" && data.messageId && typeof data.message === "string" && this.session) {
            const user = data.role === "user";
            // User messages added mid-turn already carry their full ID.
            const id = user ? data.messageId : `${t.id}:${data.messageId}`;
            const messages = this.session.messages ??= [];
            const existing = messages.find((m) => m.id === id);
            if (existing) existing.content = data.message;
            else messages.push({ id, taskId: t.id, role: user ? "user" : "assistant", content: data.message, createdAt: data.timestamp });
            this.changed();
          }
          if (data.status && this.session) {
            task.status = data.status;
            task.error = data.status === "failed" ? data.message : null;
            if (data.status === "running") {
              task.startedAt ??= data.timestamp;
              task.queuePosition = undefined;
              task.queueReason = undefined;
            }
            if (terminal(data.status)) task.finishedAt ??= data.timestamp;
            this.session.status = data.status;
            const summary = this.sessions.find((s) => s.id === this.sessionId);
            if (summary) summary.status = data.status;
            if (terminal(data.status)) {
              this.session.activeTaskId = undefined;
              this.cancelling = false;
              this.stop();
              void this.recover(revision);
            }
            this.changed();
          } else if (type === "error") {
            this.fail(new Error(data.message || "Runner error"));
          }
        } catch (err) {
          this.log(`event decode failed: ${String(err)}`);
        }
      });
    }
    es.onerror = (raw) => {
      if (!current()) return;
      if (raw && typeof raw === "object" && "data" in raw) return;
      this.log("SSE interrupted; reconnecting and restoring history");
      // The stream reconnects after its last event ID. A snapshot also recovers daemon restarts.
      void this.recover(revision);
    };
  }

  private async recover(revision: number): Promise<void> {
    if (this.recovering === revision || !this.sessionId) return;
    this.recovering = revision;
    const id = this.sessionId;
    try {
      const detail = mergeDetail(this.snapshot(), await this.detail(id, this.rev));
      if (revision !== this.revision) return;
      const latest = detail.tasks[detail.tasks.length - 1];
      const current = this.currentTask;
      // An in-flight snapshot must not overwrite a newer event already displayed.
      if (!latest || latest.id !== current?.id || latest.eventId >= this.cursor || terminal(latest.status)) {
        const changedTask = latest?.id !== current?.id;
        this.apply(detail);
        this.error = "";
        if (!this.busy) this.stop();
        else if (changedTask || !this.source) this.subscribe();
        this.changed();
      }
      await this.list(revision);
    } catch (err) {
      this.log(`history recovery failed: ${String(err)}`);
      // A revoked credential ends the conversation view; reconnects would only repeat the 401.
      if (err instanceof UnauthorizedError && revision === this.revision) {
        this.stop();
        this.fail(err);
      }
    } finally {
      if (this.recovering === revision) this.recovering = null;
    }
  }

  /** The visible conversation as held now, or null before it has loaded. */
  private snapshot(): SessionDetail | null {
    if (!this.session || this.session.id !== this.sessionId) return null;
    return { session: this.session, tasks: this.tasks, activities: this.activities, questions: this.questions, rev: this.rev };
  }

  private remember(): void {
    const s = this.snapshot();
    if (!s) return;
    this.cache.delete(s.session.id);
    this.cache.set(s.session.id, s);
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
  }

  private stop(): void {
    this.source?.close();
    this.source = null;
  }

  private fail(err: unknown): void {
    this.error = err instanceof Error ? err.message : String(err);
    this.log(this.error);
    this.changed();
  }
}
