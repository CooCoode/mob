// EventSource over fetch: native EventSource cannot send the Authorization header.

export interface StreamEvent {
  type: string;
  data: string;
  lastEventId: string;
}

export interface StreamOptions {
  headers?: () => HeadersInit;
  /** The stream stops for good on 401; the credential is not retried. */
  onUnauthorized?: () => void;
  /**
   * Resume through this query parameter instead of the Last-Event-ID header
   * (mobd accepts `after`, and cross-origin Last-Event-ID needs a CORS allowance).
   */
  resumeParam?: string;
  /** First reconnect delay in ms; doubles per failure up to maxRetry. */
  retry?: number;
  maxRetry?: number;
  fetch?: typeof fetch;
}

/** Incremental text/event-stream parser (WHATWG HTML §9.2.6). */
export class SSEParser {
  /** ID of the last dispatched event; survives reconnects. */
  lastEventId: string;
  retry: number | undefined;
  private buffer = "";
  private data: string[] = [];
  private type = "";
  private id: string;
  private dispatch: (ev: StreamEvent) => void;

  constructor(dispatch: (ev: StreamEvent) => void, lastEventId = "") {
    this.dispatch = dispatch;
    this.lastEventId = lastEventId;
    this.id = lastEventId;
  }

  push(chunk: string): void {
    const buf = this.buffer + chunk;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c !== "\n" && c !== "\r") continue;
      // A trailing CR may be the first half of CRLF; wait for the next chunk.
      if (c === "\r" && i + 1 === buf.length) break;
      this.line(buf.slice(start, i));
      if (c === "\r" && buf[i + 1] === "\n") i++;
      start = i + 1;
    }
    this.buffer = buf.slice(start);
  }

  private line(line: string): void {
    if (!line) {
      this.lastEventId = this.id;
      if (this.data.length) this.dispatch({ type: this.type || "message", data: this.data.join("\n"), lastEventId: this.id });
      this.data = [];
      this.type = "";
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.type = value;
    else if (field === "id" && !value.includes("\0")) this.id = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
  }
}

class FatalStream extends Error {}

export class EventStream {
  readonly url: string;
  lastEventId = "";
  /** 0 connecting, 1 open, 2 closed — as EventSource.readyState. */
  readyState = 0;
  onopen: (() => void) | null = null;
  /** Transport errors only, before each reconnect; named "error" events go to listeners. */
  onerror: ((err?: unknown) => void) | null = null;
  private options: StreamOptions;
  private listeners = new Map<string, Set<(ev: StreamEvent) => void>>();
  private abort: AbortController | null = null;
  private wake: (() => void) | null = null;

  constructor(url: string, options: StreamOptions = {}) {
    this.url = url;
    this.options = options;
    void this.run();
  }

  addEventListener(type: string, listener: (ev: StreamEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  removeEventListener(type: string, listener: (ev: StreamEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
    this.abort?.abort();
    this.wake?.();
  }

  private get closed(): boolean {
    return this.readyState === 2;
  }

  private target(): string {
    const param = this.options.resumeParam;
    if (!param || !this.lastEventId) return this.url;
    const url = new URL(this.url);
    url.searchParams.set(param, this.lastEventId);
    return url.toString();
  }

  private async run(): Promise<void> {
    const first = this.options.retry ?? 1000;
    const max = this.options.maxRetry ?? 30_000;
    let delay = first;
    while (!this.closed) {
      const abort = new AbortController();
      this.abort = abort;
      try {
        const headers = new Headers(this.options.headers?.());
        headers.set("Accept", "text/event-stream");
        if (this.lastEventId && !this.options.resumeParam) headers.set("Last-Event-ID", this.lastEventId);
        const res = await (this.options.fetch ?? fetch)(this.target(), {
          headers, signal: abort.signal, cache: "no-store", redirect: "error",
        });
        if (this.closed) return;
        if (res.status === 401) {
          this.close();
          this.options.onUnauthorized?.();
          return;
        }
        // Like EventSource: other HTTP failures and wrong content types do not reconnect; 5xx and 429 do.
        if (!res.ok || !res.body) {
          if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
          throw new FatalStream(`HTTP ${res.status}`);
        }
        if (!/^text\/event-stream/i.test(res.headers.get("Content-Type") ?? "")) throw new FatalStream("not an event stream");
        this.readyState = 1;
        delay = first;
        this.onopen?.();
        const parser = new SSEParser((ev) => this.emit(ev), this.lastEventId);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.closed) break;
          parser.push(decoder.decode(value, { stream: true }));
          this.lastEventId = parser.lastEventId;
          if (parser.retry !== undefined) delay = parser.retry;
        }
        if (this.closed) return;
        throw new Error("stream ended");
      } catch (err) {
        if (this.closed) return;
        if (err instanceof FatalStream) {
          this.close();
          this.onerror?.(err);
          return;
        }
        this.readyState = 0;
        this.onerror?.(err);
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        this.wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.wake = null;
      delay = Math.min(delay * 2, max);
    }
  }

  private emit(ev: StreamEvent): void {
    if (this.closed) return;
    this.lastEventId = ev.lastEventId;
    for (const listener of this.listeners.get(ev.type) ?? []) {
      try {
        listener(ev);
      } catch (err) {
        console.error(err);
      }
    }
  }
}
