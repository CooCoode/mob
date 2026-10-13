export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Task {
  id: string;
  sessionId: string;
  eventId: number;
  prompt: string;
  status: TaskStatus;
  runner: string;
  error?: string | null;
}

export interface ChatMessage {
  id: string;
  taskId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Session {
  id: string;
  title: string;
  activeTaskId?: string;
  status: TaskStatus;
  messages?: ChatMessage[];
}

interface SessionDetail {
  session: Session;
  tasks: Task[];
}

interface TaskEvent {
  id: number;
  type: string;
  message?: string;
  messageId?: string;
  status?: TaskStatus;
  timestamp: string;
}

export function terminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

// Owns one visible conversation. Requests for a previous selection cannot replace it.
export class Chat {
  machineId = "";
  sessions: Session[] = [];
  sessionId: string | null = null;
  session: Session | null = null;
  tasks: Task[] = [];
  ready = false;
  loading = false;
  submitting = false;
  cancelling = false;
  error = "";

  private url = "";
  private revision = 0;
  private source: EventSource | null = null;
  private cursor = 0;
  private recovering: number | null = null;

  constructor(
    private changed: () => void,
    private log: (line: string) => void,
  ) {}

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

  newChat(): void {
    this.revision++;
    this.stop();
    this.cursor = 0;
    this.sessionId = null;
    this.session = null;
    this.tasks = [];
    this.error = "";
    this.loading = false;
    this.cancelling = false;
    this.changed();
  }

  async open(id: string): Promise<void> {
    const revision = ++this.revision;
    this.stop();
    this.cursor = 0;
    this.sessionId = id;
    this.session = null;
    this.tasks = [];
    this.error = "";
    this.loading = true;
    this.cancelling = false;
    this.changed();
    try {
      const detail = await this.detail(id);
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

  async submit(prompt: string): Promise<boolean> {
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
        body: JSON.stringify({ prompt, sessionId: sessionId ?? undefined }),
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
      this.sessions = [{ id: t.sessionId, title: this.session.title, status: t.status, activeTaskId: t.id },
        ...this.sessions.filter((s) => s.id !== t.sessionId)];
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

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (res.status === 404 && url.endsWith("/sessions")) {
      throw new Error("Update office mobd to support chat sessions.");
    }
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

  private async detail(id: string): Promise<SessionDetail> {
    const data = await this.request<SessionDetail>(`${this.url}/sessions/${id}`);
    if (data.session?.id !== id || !Array.isArray(data.tasks)) {
      throw new Error("Invalid session history from mobd.");
    }
    return data;
  }

  private apply(detail: SessionDetail): void {
    this.session = detail.session;
    this.tasks = detail.tasks;
    this.cursor = this.currentTask?.eventId ?? 0;
    if (!this.busy) this.cancelling = false;
  }

  private subscribe(): void {
    const t = this.currentTask;
    if (!t || terminal(t.status)) return;
    this.stop();
    const revision = this.revision;
    const es = new EventSource(`${this.url}/tasks/${t.id}/events?after=${this.cursor}`);
    this.source = es;
    const current = () => this.source === es && this.revision === revision;
    for (const type of ["status", "message", "thread", "log", "progress", "error"]) {
      es.addEventListener(type, (raw) => {
        if (!current()) return;
        const ev = raw as MessageEvent<string>;
        if (!ev.data) return;
        try {
          const data = JSON.parse(ev.data) as TaskEvent;
          if (!Number.isSafeInteger(data.id) || data.id <= this.cursor) return;
          const task = this.currentTask;
          if (!task || task.id !== t.id) return;
          this.cursor = data.id;
          task.eventId = data.id;
          this.log(`${type}: ${data.message ?? data.status ?? ""}`);
          if (type === "message" && data.messageId && typeof data.message === "string" && this.session) {
            const id = `${t.id}:${data.messageId}`;
            const messages = this.session.messages ??= [];
            const existing = messages.find((m) => m.id === id);
            if (existing) existing.content = data.message;
            else messages.push({ id, taskId: t.id, role: "assistant", content: data.message, createdAt: data.timestamp });
            this.changed();
          }
          if (data.status && this.session) {
            task.status = data.status;
            task.error = data.status === "failed" ? data.message : null;
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
      if ("data" in (raw ?? {})) return;
      this.log("SSE interrupted; reconnecting and restoring history");
      // Native EventSource retries with Last-Event-ID. A snapshot also recovers daemon restarts.
      void this.recover(revision);
    };
  }

  private async recover(revision: number): Promise<void> {
    if (this.recovering === revision || !this.sessionId) return;
    this.recovering = revision;
    const id = this.sessionId;
    try {
      const detail = await this.detail(id);
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
    } finally {
      if (this.recovering === revision) this.recovering = null;
    }
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
