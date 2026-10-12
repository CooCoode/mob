type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  runner: string;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
  vncViewUrl?: string;
}

interface TaskEvent {
  type: string;
  message?: string;
  status?: TaskStatus;
  timestamp: string;
}

type SvncClientLike = {
  disconnect: () => void;
  desktop?: { width: number; height: number } | null;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

type SvncConnect = (
  el: HTMLElement,
  opts: {
    url: string;
    credentials?: { password: string };
    viewOnly: boolean;
  },
) => Promise<SvncClientLike>;

const mobdUrlInput = document.querySelector<HTMLInputElement>("#mobd-url")!;
const vncWsUrlInput = document.querySelector<HTMLInputElement>("#vnc-ws-url")!;
const vncPasswordInput =
  document.querySelector<HTMLInputElement>("#vnc-password")!;
const promptInput = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const taskMeta = document.querySelector<HTMLElement>("#task-meta")!;
const taskLog = document.querySelector<HTMLPreElement>("#task-log")!;
const taskList = document.querySelector<HTMLUListElement>("#task-list")!;
const healthStatus = document.querySelector<HTMLElement>("#health-status")!;
const vncStatus = document.querySelector<HTMLElement>("#vnc-status")!;
const screenEl = document.querySelector<HTMLElement>("#screen")!;

const btnHealth = document.querySelector<HTMLButtonElement>("#btn-health")!;
const btnSubmit = document.querySelector<HTMLButtonElement>("#btn-submit")!;
const btnCancel = document.querySelector<HTMLButtonElement>("#btn-cancel")!;
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh")!;
const btnConnect = document.querySelector<HTMLButtonElement>("#btn-connect")!;
const btnDisconnect =
  document.querySelector<HTMLButtonElement>("#btn-disconnect")!;

let activeTaskId: string | null = null;
let eventSource: EventSource | null = null;
let vncClient: SvncClientLike | null = null;
let svncConnect: SvncConnect | null = null;
let svncLoadError: string | null = null;

function envDefault(...keys: (keyof ImportMetaEnv)[]): string {
  for (const key of keys) {
    const v = import.meta.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function baseUrl(): string {
  return mobdUrlInput.value.trim().replace(/\/$/, "");
}

function appendLog(line: string): void {
  const stamp = new Date().toLocaleTimeString();
  taskLog.textContent += `[${stamp}] ${line}\n`;
  taskLog.scrollTop = taskLog.scrollHeight;
}

function setActiveTask(task: Task | null): void {
  if (!task) {
    activeTaskId = null;
    taskMeta.textContent = "No active task";
    btnCancel.disabled = true;
    return;
  }
  activeTaskId = task.id;
  taskMeta.textContent = `${task.id} · ${task.status} · ${task.runner}`;
  btnCancel.disabled = !(
    task.status === "queued" || task.status === "running"
  );
}

async function loadSvnc(): Promise<void> {
  try {
    const mod = await import("svnc");
    svncConnect = mod.SVNCClient.connect.bind(mod.SVNCClient) as SvncConnect;
    svncLoadError = null;
  } catch (err) {
    svncConnect = null;
    svncLoadError =
      err instanceof Error ? err.message : "failed to import svnc";
    screenEl.classList.add("stub");
    screenEl.textContent =
      "svnc package not built yet. Run npm install (postinstall builds github:xrdavies/svnc). You can still dispatch tasks.";
  }
}

async function pingHealth(): Promise<void> {
  const url = baseUrl();
  if (!url) {
    healthStatus.textContent = "set MOBD_URL first";
    return;
  }
  healthStatus.textContent = "…";
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { ok?: boolean; vncViewUrl?: string };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    healthStatus.textContent = body.ok ? "ok" : "unexpected";
    if (body.vncViewUrl) {
      appendLog(`health.vncViewUrl=${body.vncViewUrl}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    healthStatus.textContent = `error: ${msg}`;
    appendLog(
      `health failed: ${msg} (if CORS, bind mobd on LAN/VPN and add CORS — see docs)`,
    );
  }
}

async function refreshTasks(): Promise<void> {
  const url = baseUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/tasks`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tasks = (await res.json()) as Task[];
    taskList.innerHTML = "";
    for (const t of tasks.slice(0, 20)) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${t.id.slice(0, 8)}…</span><span>${t.status}</span>`;
      li.title = t.prompt;
      li.addEventListener("click", () => {
        setActiveTask(t);
        subscribeEvents(t.id);
      });
      taskList.appendChild(li);
    }
  } catch (err) {
    appendLog(
      `list tasks failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function stopEvents(): void {
  eventSource?.close();
  eventSource = null;
}

function subscribeEvents(id: string): void {
  const url = baseUrl();
  if (!url) return;
  stopEvents();
  taskLog.textContent = "";
  appendLog(`subscribe ${id}`);
  const es = new EventSource(`${url}/tasks/${id}/events`);
  eventSource = es;

  const onPayload = (type: string, ev: MessageEvent<string>) => {
    try {
      const data = JSON.parse(ev.data) as TaskEvent;
      const bit = data.message || data.status || "";
      appendLog(`${type}: ${bit}`);
      if (data.status && activeTaskId === id) {
        taskMeta.textContent = `${id} · ${data.status}`;
        btnCancel.disabled = !(
          data.status === "queued" || data.status === "running"
        );
      }
    } catch {
      appendLog(`${type}: ${ev.data}`);
    }
  };

  for (const type of ["status", "log", "progress", "error"]) {
    es.addEventListener(type, (ev) =>
      onPayload(type, ev as MessageEvent<string>),
    );
  }
  es.onerror = () => {
    appendLog("SSE closed or error");
    stopEvents();
    void refreshTasks();
  };
}

async function submitTask(): Promise<void> {
  const url = baseUrl();
  const prompt = promptInput.value.trim();
  if (!url) {
    appendLog("set MOBD_URL");
    return;
  }
  if (!prompt) {
    appendLog("enter a prompt");
    return;
  }
  btnSubmit.disabled = true;
  try {
    const res = await fetch(`${url}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const body = (await res.json()) as Task & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setActiveTask(body);
    appendLog(`created ${body.id}`);
    subscribeEvents(body.id);
    await refreshTasks();
  } catch (err) {
    appendLog(`create failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btnSubmit.disabled = false;
  }
}

async function cancelTask(): Promise<void> {
  const url = baseUrl();
  if (!url || !activeTaskId) return;
  try {
    const res = await fetch(`${url}/tasks/${activeTaskId}/cancel`, {
      method: "POST",
    });
    const body = (await res.json()) as Task & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setActiveTask(body);
    appendLog(`cancel → ${body.status}`);
    await refreshTasks();
  } catch (err) {
    appendLog(`cancel failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function setVncConnected(on: boolean): void {
  btnConnect.disabled = on;
  btnDisconnect.disabled = !on;
}

async function connectVnc(): Promise<void> {
  const url = vncWsUrlInput.value.trim();
  if (!url) {
    vncStatus.textContent = "set VNC_WS_URL";
    return;
  }
  if (!svncConnect) {
    vncStatus.textContent = svncLoadError || "svnc unavailable";
    return;
  }
  if (vncClient) return;
  vncStatus.textContent = "connecting…";
  screenEl.classList.remove("stub");
  screenEl.replaceChildren();
  try {
    const password = vncPasswordInput.value;
    vncClient = await svncConnect(screenEl, {
      url,
      credentials: password ? { password } : undefined,
      viewOnly: true,
    });
    setVncConnected(true);
    const d = vncClient.desktop;
    vncStatus.textContent = d
      ? `connected ${d.width}×${d.height} (viewOnly)`
      : "connected (viewOnly)";
    vncClient.on("disconnect", () => {
      vncClient = null;
      setVncConnected(false);
      vncStatus.textContent = "disconnected";
    });
  } catch (err) {
    vncClient = null;
    setVncConnected(false);
    vncStatus.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function disconnectVnc(): void {
  vncClient?.disconnect();
  vncClient = null;
  setVncConnected(false);
  vncStatus.textContent = "disconnected";
}

function boot(): void {
  mobdUrlInput.value =
    envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";
  vncWsUrlInput.value =
    envDefault("VNC_WS_URL", "VITE_VNC_WS_URL") || "ws://127.0.0.1:6080/";

  btnHealth.addEventListener("click", () => void pingHealth());
  btnSubmit.addEventListener("click", () => void submitTask());
  btnCancel.addEventListener("click", () => void cancelTask());
  btnRefresh.addEventListener("click", () => void refreshTasks());
  btnConnect.addEventListener("click", () => void connectVnc());
  btnDisconnect.addEventListener("click", () => disconnectVnc());

  void loadSvnc().then(() => {
    appendLog(
      svncConnect
        ? "svnc ready (viewOnly embed)"
        : `svnc stub: ${svncLoadError ?? "unavailable"}`,
    );
  });
}

boot();
