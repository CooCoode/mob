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

interface Machine {
  id: string;
  name: string;
  mobdUrl: string;
  vncWsUrl: string;
  vncPassword?: string;
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

const STORAGE_MACHINES = "mob.machines";
const STORAGE_ACTIVE = "mob.activeMachineId";
const STORAGE_LEGACY_MOBD = "mob.mobdUrl";
const STORAGE_LEGACY_VNC = "mob.vncWsUrl";
const SCREEN_EMPTY =
  "Connect to watch the office desktop. Mouse and keyboard stay off.";

const machineTree = document.querySelector<HTMLElement>("#machine-tree")!;
const sidebarEmpty = document.querySelector<HTMLElement>("#sidebar-empty")!;
const chatStream = document.querySelector<HTMLElement>("#chat-stream")!;
const taskMeta = document.querySelector<HTMLElement>("#task-meta")!;
const taskMetaPill = taskMeta.querySelector<HTMLElement>(".pill")!;
const taskMetaText = document.querySelector<HTMLElement>("#task-meta-text")!;
const promptInput = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const healthStatus = document.querySelector<HTMLElement>("#health-status")!;
const vncStatus = document.querySelector<HTMLElement>("#vnc-status")!;
const fsVncStatus = document.querySelector<HTMLElement>("#fs-vnc-status")!;
const vncChipText = document.querySelector<HTMLElement>("#vnc-chip-text")!;
const dotOffice = document.querySelector<HTMLElement>("#dot-office")!;
const dotVnc = document.querySelector<HTMLElement>("#dot-vnc")!;
const screenEl = document.querySelector<HTMLElement>("#screen")!;
const previewFs = document.querySelector<HTMLElement>("#preview-fullscreen")!;
const screenFsHost = document.querySelector<HTMLElement>("#screen-fs-host")!;
const previewPane = document.querySelector<HTMLElement>(".preview")!;
const settingsOverlay =
  document.querySelector<HTMLElement>("#settings-overlay")!;
const settingsList = document.querySelector<HTMLUListElement>(
  "#settings-machine-list",
)!;
const machineForm = document.querySelector<HTMLFormElement>("#machine-form")!;
const mfId = document.querySelector<HTMLInputElement>("#mf-id")!;
const mfName = document.querySelector<HTMLInputElement>("#mf-name")!;
const mfMobd = document.querySelector<HTMLInputElement>("#mf-mobd")!;
const mfVnc = document.querySelector<HTMLInputElement>("#mf-vnc")!;
const mfPassword = document.querySelector<HTMLInputElement>("#mf-password")!;
const mfStatus = document.querySelector<HTMLElement>("#mf-status")!;
const btnMfDelete =
  document.querySelector<HTMLButtonElement>("#btn-mf-delete")!;

const btnSettings =
  document.querySelector<HTMLButtonElement>("#btn-settings")!;
const btnSettingsClose = document.querySelector<HTMLButtonElement>(
  "#btn-settings-close",
)!;
const btnAddMachine =
  document.querySelector<HTMLButtonElement>("#btn-add-machine")!;
const btnSubmit = document.querySelector<HTMLButtonElement>("#btn-submit")!;
const btnCancel = document.querySelector<HTMLButtonElement>("#btn-cancel")!;
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh")!;
const btnConnect = document.querySelector<HTMLButtonElement>("#btn-connect")!;
const btnDisconnect =
  document.querySelector<HTMLButtonElement>("#btn-disconnect")!;
const btnFsExit = document.querySelector<HTMLButtonElement>("#btn-fs-exit")!;
const btnMfPing = document.querySelector<HTMLButtonElement>("#btn-mf-ping")!;
const btnMfNew = document.querySelector<HTMLButtonElement>("#btn-mf-new")!;

let machines: Machine[] = [];
let activeMachineId: string | null = null;
let collapsedMachines = new Set<string>();
let tasksByMachine = new Map<string, Task[]>();
let activeTaskId: string | null = null;
let eventSource: EventSource | null = null;
let vncClient: SvncClientLike | null = null;
let svncConnect: SvncConnect | null = null;
let svncLoadError: string | null = null;
let previewExpanded = false;

function envDefault(...keys: (keyof ImportMetaEnv)[]): string {
  for (const key of keys) {
    const v = import.meta.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function uid(): string {
  return crypto.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeMachine(): Machine | null {
  return machines.find((m) => m.id === activeMachineId) ?? null;
}

function baseUrl(m?: Machine | null): string {
  const machine = m ?? activeMachine();
  return (machine?.mobdUrl ?? "").trim().replace(/\/$/, "");
}

function loadMachines(): Machine[] {
  try {
    const raw = localStorage.getItem(STORAGE_MACHINES);
    if (raw) {
      const parsed = JSON.parse(raw) as Machine[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }

  // Migrate legacy single-URL keys or env defaults into one machine
  let mobd = "";
  let vnc = "";
  try {
    mobd = localStorage.getItem(STORAGE_LEGACY_MOBD)?.trim() || "";
    vnc = localStorage.getItem(STORAGE_LEGACY_VNC)?.trim() || "";
  } catch {
    /* ignore */
  }
  mobd = mobd || envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";
  vnc =
    vnc ||
    envDefault("VNC_WS_URL", "VITE_VNC_WS_URL") ||
    "ws://127.0.0.1:6080/";

  return [
    {
      id: uid(),
      name: "Default",
      mobdUrl: mobd,
      vncWsUrl: vnc,
    },
  ];
}

function persistMachines(): void {
  try {
    localStorage.setItem(STORAGE_MACHINES, JSON.stringify(machines));
    if (activeMachineId) {
      localStorage.setItem(STORAGE_ACTIVE, activeMachineId);
    }
  } catch {
    /* ignore */
  }
}

function setDot(el: HTMLElement, state: string): void {
  el.dataset.state = state;
}

function appendChat(
  line: string,
  kind: "system" | "user" | "status" | "error" | "log" = "system",
): void {
  const stamp = new Date().toLocaleTimeString();
  const p = document.createElement("p");
  p.className = `chat-msg ${kind}`;
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = `[${stamp}]`;
  p.appendChild(ts);
  p.appendChild(document.createTextNode(line));
  chatStream.appendChild(p);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function clearChat(): void {
  chatStream.replaceChildren();
}

function setActiveTask(task: Task | null): void {
  if (!task) {
    activeTaskId = null;
    taskMetaPill.dataset.status = "none";
    taskMetaPill.textContent = "idle";
    taskMetaText.textContent = "No active task";
    btnCancel.disabled = true;
    renderMachineTree();
    return;
  }
  activeTaskId = task.id;
  taskMetaPill.dataset.status = task.status;
  taskMetaPill.textContent = task.status;
  taskMetaText.textContent = `${task.id.slice(0, 8)}… · ${task.runner}`;
  btnCancel.disabled = !(
    task.status === "queued" || task.status === "running"
  );
  renderMachineTree();
}

function updateActiveStatus(status: TaskStatus): void {
  if (!activeTaskId) return;
  taskMetaPill.dataset.status = status;
  taskMetaPill.textContent = status;
  btnCancel.disabled = !(status === "queued" || status === "running");
  const mid = activeMachineId;
  if (mid) {
    const list = tasksByMachine.get(mid) ?? [];
    const t = list.find((x) => x.id === activeTaskId);
    if (t) t.status = status;
  }
  renderMachineTree();
}

function snippet(prompt: string, n = 36): string {
  const one = prompt.replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  return `${one.slice(0, n)}…`;
}

function renderMachineTree(): void {
  machineTree.replaceChildren();
  sidebarEmpty.hidden = machines.length > 0;

  for (const m of machines) {
    const group = document.createElement("div");
    group.className = "machine-group";
    if (m.id === activeMachineId) group.classList.add("active");

    const collapsed = collapsedMachines.has(m.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "machine-group-btn";
    btn.innerHTML = `<span class="chevron">${collapsed ? "▶" : "▼"}</span><span></span>`;
    const nameSpan = btn.querySelector("span:last-child")!;
    nameSpan.textContent = m.name;
    btn.addEventListener("click", () => {
      if (activeMachineId !== m.id) {
        void selectMachine(m.id);
      } else {
        if (collapsedMachines.has(m.id)) collapsedMachines.delete(m.id);
        else collapsedMachines.add(m.id);
        renderMachineTree();
      }
    });
    group.appendChild(btn);

    if (!collapsed) {
      const ul = document.createElement("ul");
      ul.className = "session-list";

      const defaultLi = document.createElement("li");
      defaultLi.dataset.id = "default";
      if (m.id === activeMachineId && !activeTaskId) {
        defaultLi.classList.add("active");
      }
      defaultLi.innerHTML = `<span class="snippet">default session</span>`;
      defaultLi.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void selectMachine(m.id);
        setActiveTask(null);
        stopEvents();
        clearChat();
        appendChat(`machine ${m.name} · default session`, "system");
      });
      ul.appendChild(defaultLi);

      const tasks = tasksByMachine.get(m.id) ?? [];
      for (const t of tasks.slice(0, 12)) {
        const li = document.createElement("li");
        li.dataset.id = t.id;
        if (m.id === activeMachineId && t.id === activeTaskId) {
          li.classList.add("active");
        }
        li.innerHTML = `<span class="id">${t.id.slice(0, 8)}…</span><span class="snippet"></span><span class="pill" data-status="${t.status}">${t.status}</span>`;
        const sn = li.querySelector(".snippet");
        if (sn) sn.textContent = snippet(t.prompt);
        li.title = t.prompt;
        li.addEventListener("click", (ev) => {
          ev.stopPropagation();
          void selectMachine(m.id).then(() => {
            setActiveTask(t);
            subscribeEvents(t.id);
          });
        });
        ul.appendChild(li);
      }
      group.appendChild(ul);
    }

    machineTree.appendChild(group);
  }
}

async function selectMachine(id: string): Promise<void> {
  if (activeMachineId === id) return;
  const prev = activeMachineId;
  activeMachineId = id;
  persistMachines();

  // Disconnect VNC when switching machines
  if (prev && vncClient) {
    disconnectVnc();
  }

  stopEvents();
  activeTaskId = null;
  setActiveTask(null);
  clearChat();
  const m = activeMachine();
  appendChat(`selected machine: ${m?.name ?? id}`, "system");
  renderMachineTree();
  await pingHealth();
  await refreshTasks();
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

async function pingHealth(m?: Machine | null): Promise<boolean> {
  const machine = m ?? activeMachine();
  const url = baseUrl(machine);
  const statusEl = m && m.id !== activeMachineId ? mfStatus : healthStatus;
  if (!url) {
    if (statusEl === healthStatus) {
      healthStatus.textContent = "set machine";
      setDot(dotOffice, "unknown");
    } else {
      mfStatus.textContent = "set MOBD_URL";
    }
    return false;
  }
  if (statusEl === healthStatus) {
    healthStatus.textContent = "…";
    setDot(dotOffice, "busy");
  } else {
    mfStatus.textContent = "pinging…";
  }
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { ok?: boolean; vncViewUrl?: string };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ok = !!body.ok;
    if (statusEl === healthStatus) {
      healthStatus.textContent = ok ? "ok" : "unexpected";
      setDot(dotOffice, ok ? "ok" : "error");
    } else {
      mfStatus.textContent = ok ? "health ok" : "health unexpected";
    }
    if (body.vncViewUrl && statusEl === healthStatus) {
      appendChat(`health.vncViewUrl=${body.vncViewUrl}`, "system");
    }
    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (statusEl === healthStatus) {
      healthStatus.textContent = "error";
      setDot(dotOffice, "error");
      appendChat(
        `health failed: ${msg} (if CORS, bind mobd on LAN/VPN and add CORS — see docs)`,
        "error",
      );
    } else {
      mfStatus.textContent = `error: ${msg}`;
    }
    return false;
  }
}

async function refreshTasks(): Promise<void> {
  const url = baseUrl();
  const mid = activeMachineId;
  if (!url || !mid) return;
  try {
    const res = await fetch(`${url}/tasks`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tasks = (await res.json()) as Task[];
    tasksByMachine.set(mid, tasks.slice(0, 20));
    renderMachineTree();
  } catch (err) {
    appendChat(
      `list tasks failed: ${err instanceof Error ? err.message : String(err)}`,
      "error",
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
  clearChat();
  appendChat(`subscribe ${id}`, "system");
  const es = new EventSource(`${url}/tasks/${id}/events`);
  eventSource = es;

  const onPayload = (type: string, ev: MessageEvent<string>) => {
    try {
      const data = JSON.parse(ev.data) as TaskEvent;
      const bit = data.message || data.status || "";
      const kind =
        type === "error"
          ? "error"
          : type === "status"
            ? "status"
            : "log";
      appendChat(`${type}: ${bit}`, kind);
      if (data.status && activeTaskId === id) {
        updateActiveStatus(data.status);
      }
    } catch {
      appendChat(`${type}: ${ev.data}`, "log");
    }
  };

  for (const type of ["status", "log", "progress", "error"]) {
    es.addEventListener(type, (ev) =>
      onPayload(type, ev as MessageEvent<string>),
    );
  }
  es.onerror = () => {
    appendChat("SSE closed or error", "error");
    stopEvents();
    void refreshTasks();
  };
}

async function submitTask(): Promise<void> {
  const url = baseUrl();
  const prompt = promptInput.value.trim();
  if (!url) {
    appendChat("select a machine with MOBD_URL (Settings)", "error");
    return;
  }
  if (!prompt) {
    appendChat("enter a prompt", "error");
    return;
  }
  btnSubmit.disabled = true;
  appendChat(prompt, "user");
  try {
    const res = await fetch(`${url}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const body = (await res.json()) as Task & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setActiveTask(body);
    appendChat(`created ${body.id}`, "status");
    promptInput.value = "";
    subscribeEvents(body.id);
    await refreshTasks();
  } catch (err) {
    appendChat(
      `create failed: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
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
    appendChat(`cancel → ${body.status}`, "status");
    await refreshTasks();
  } catch (err) {
    appendChat(
      `cancel failed: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function syncVncStatusText(text: string): void {
  vncStatus.textContent = text;
  fsVncStatus.textContent = text;
}

function setVncConnected(on: boolean): void {
  btnConnect.disabled = on;
  btnDisconnect.disabled = !on;
  setDot(dotVnc, on ? "ok" : "off");
  vncChipText.textContent = on ? "on" : "off";
}

async function connectVnc(): Promise<void> {
  const m = activeMachine();
  const url = m?.vncWsUrl.trim() ?? "";
  if (!url) {
    syncVncStatusText("set VNC_WS_URL in Settings");
    return;
  }
  if (!svncConnect) {
    syncVncStatusText(svncLoadError || "svnc unavailable");
    setDot(dotVnc, "error");
    vncChipText.textContent = "err";
    return;
  }
  if (vncClient) return;
  syncVncStatusText("connecting…");
  setDot(dotVnc, "busy");
  vncChipText.textContent = "…";
  screenEl.classList.remove("stub");
  screenEl.replaceChildren();
  try {
    const password = m?.vncPassword ?? "";
    vncClient = await svncConnect(screenEl, {
      url,
      credentials: password ? { password } : undefined,
      viewOnly: true,
    });
    setVncConnected(true);
    const d = vncClient.desktop;
    syncVncStatusText(
      d
        ? `connected ${d.width}×${d.height} (viewOnly)`
        : "connected (viewOnly)",
    );
    vncClient.on("disconnect", () => {
      vncClient = null;
      setVncConnected(false);
      syncVncStatusText("disconnected");
      exitPreviewFullscreen();
      screenEl.classList.add("stub");
      screenEl.classList.add("thumbnail");
      screenEl.textContent = SCREEN_EMPTY;
    });
  } catch (err) {
    vncClient = null;
    setVncConnected(false);
    setDot(dotVnc, "error");
    vncChipText.textContent = "err";
    syncVncStatusText(
      `error: ${err instanceof Error ? err.message : String(err)}`,
    );
    screenEl.classList.add("stub");
    screenEl.classList.add("thumbnail");
    screenEl.textContent = SCREEN_EMPTY;
  }
}

function disconnectVnc(): void {
  vncClient?.disconnect();
  vncClient = null;
  setVncConnected(false);
  syncVncStatusText("disconnected");
  exitPreviewFullscreen();
  screenEl.classList.add("stub");
  screenEl.classList.add("thumbnail");
  screenEl.classList.remove("fullscreen-mode");
  screenEl.textContent = SCREEN_EMPTY;
}

function enterPreviewFullscreen(): void {
  if (previewExpanded) return;
  if (screenEl.classList.contains("stub") && !vncClient) return;
  previewExpanded = true;
  document.body.classList.add("is-preview-fs");
  previewFs.hidden = false;
  previewFs.setAttribute("aria-hidden", "false");
  screenEl.classList.add("fullscreen-mode");
  screenEl.classList.remove("thumbnail");
  screenFsHost.appendChild(screenEl);
  fsVncStatus.textContent = vncStatus.textContent;
}

function exitPreviewFullscreen(): void {
  if (!previewExpanded) return;
  previewExpanded = false;
  document.body.classList.remove("is-preview-fs");
  previewFs.hidden = true;
  previewFs.setAttribute("aria-hidden", "true");
  screenEl.classList.remove("fullscreen-mode");
  screenEl.classList.add("thumbnail");
  // Re-insert screen before the hint paragraph
  const hint = previewPane.querySelector(".hint");
  if (hint) previewPane.insertBefore(screenEl, hint);
  else previewPane.appendChild(screenEl);
}

function togglePreviewFullscreen(): void {
  if (previewExpanded) exitPreviewFullscreen();
  else enterPreviewFullscreen();
}

/* —— Settings —— */
function openSettings(editId?: string): void {
  settingsOverlay.hidden = false;
  settingsOverlay.setAttribute("aria-hidden", "false");
  renderSettingsList();
  if (editId) fillMachineForm(editId);
  else resetMachineForm();
}

function closeSettings(): void {
  settingsOverlay.hidden = true;
  settingsOverlay.setAttribute("aria-hidden", "true");
  renderMachineTree();
}

function renderSettingsList(): void {
  settingsList.replaceChildren();
  for (const m of machines) {
    const li = document.createElement("li");
    if (m.id === mfId.value) li.classList.add("selected");
    li.innerHTML = `<span class="name"></span><span class="urls"></span>`;
    li.querySelector(".name")!.textContent = m.name;
    li.querySelector(".urls")!.textContent = m.mobdUrl;
    li.addEventListener("click", () => fillMachineForm(m.id));
    settingsList.appendChild(li);
  }
}

function fillMachineForm(id: string): void {
  const m = machines.find((x) => x.id === id);
  if (!m) return;
  mfId.value = m.id;
  mfName.value = m.name;
  mfMobd.value = m.mobdUrl;
  mfVnc.value = m.vncWsUrl;
  mfPassword.value = m.vncPassword ?? "";
  btnMfDelete.hidden = false;
  mfStatus.textContent = "";
  renderSettingsList();
}

function resetMachineForm(): void {
  mfId.value = "";
  mfName.value = "";
  mfMobd.value = envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";
  mfVnc.value =
    envDefault("VNC_WS_URL", "VITE_VNC_WS_URL") || "ws://127.0.0.1:6080/";
  mfPassword.value = "";
  btnMfDelete.hidden = true;
  mfStatus.textContent = "";
  renderSettingsList();
}

function saveMachineForm(ev: Event): void {
  ev.preventDefault();
  const name = mfName.value.trim();
  const mobdUrl = mfMobd.value.trim();
  const vncWsUrl = mfVnc.value.trim();
  const vncPassword = mfPassword.value;
  if (!name || !mobdUrl || !vncWsUrl) {
    mfStatus.textContent = "name, MOBD_URL, and VNC_WS_URL required";
    return;
  }
  if (mfId.value) {
    const m = machines.find((x) => x.id === mfId.value);
    if (m) {
      m.name = name;
      m.mobdUrl = mobdUrl;
      m.vncWsUrl = vncWsUrl;
      m.vncPassword = vncPassword || undefined;
    }
  } else {
    const m: Machine = {
      id: uid(),
      name,
      mobdUrl,
      vncWsUrl,
      vncPassword: vncPassword || undefined,
    };
    machines.push(m);
    mfId.value = m.id;
    btnMfDelete.hidden = false;
    if (!activeMachineId) activeMachineId = m.id;
  }
  persistMachines();
  mfStatus.textContent = "saved";
  renderSettingsList();
  renderMachineTree();
  // If we edited the active machine, refresh health
  if (mfId.value === activeMachineId) {
    void pingHealth();
  }
}

function deleteMachine(): void {
  const id = mfId.value;
  if (!id) return;
  machines = machines.filter((m) => m.id !== id);
  tasksByMachine.delete(id);
  if (activeMachineId === id) {
    if (vncClient) disconnectVnc();
    activeMachineId = machines[0]?.id ?? null;
    persistMachines();
    if (activeMachineId) void selectMachine(activeMachineId);
  } else {
    persistMachines();
  }
  resetMachineForm();
  renderMachineTree();
  mfStatus.textContent = "deleted";
}

function boot(): void {
  machines = loadMachines();
  try {
    const saved = localStorage.getItem(STORAGE_ACTIVE);
    if (saved && machines.some((m) => m.id === saved)) {
      activeMachineId = saved;
    } else {
      activeMachineId = machines[0]?.id ?? null;
    }
  } catch {
    activeMachineId = machines[0]?.id ?? null;
  }
  persistMachines();
  renderMachineTree();

  btnSettings.addEventListener("click", () => openSettings(activeMachineId ?? undefined));
  btnSettingsClose.addEventListener("click", () => closeSettings());
  btnAddMachine.addEventListener("click", () => {
    openSettings();
    resetMachineForm();
  });
  settingsOverlay.addEventListener("click", (ev) => {
    if (ev.target === settingsOverlay) closeSettings();
  });

  machineForm.addEventListener("submit", saveMachineForm);
  btnMfNew.addEventListener("click", () => resetMachineForm());
  btnMfDelete.addEventListener("click", () => deleteMachine());
  btnMfPing.addEventListener("click", () => {
    const draft: Machine = {
      id: mfId.value || "draft",
      name: mfName.value.trim() || "draft",
      mobdUrl: mfMobd.value.trim(),
      vncWsUrl: mfVnc.value.trim(),
    };
    void pingHealth(draft);
  });

  btnSubmit.addEventListener("click", () => void submitTask());
  btnCancel.addEventListener("click", () => void cancelTask());
  btnRefresh.addEventListener("click", () => void refreshTasks());
  btnConnect.addEventListener("click", () => void connectVnc());
  btnDisconnect.addEventListener("click", () => disconnectVnc());
  btnFsExit.addEventListener("click", () => exitPreviewFullscreen());

  screenEl.addEventListener("dblclick", () => {
    if (screenEl.classList.contains("stub") && !vncClient) return;
    togglePreviewFullscreen();
  });
  screenFsHost.addEventListener("dblclick", () => exitPreviewFullscreen());

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (previewExpanded) {
        ev.preventDefault();
        exitPreviewFullscreen();
      } else if (!settingsOverlay.hidden) {
        closeSettings();
      }
    }
  });

  promptInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      void submitTask();
    }
  });

  void loadSvnc().then(() => {
    appendChat(
      svncConnect
        ? "svnc ready (viewOnly embed)"
        : `svnc stub: ${svncLoadError ?? "unavailable"}`,
      "system",
    );
  });

  const m = activeMachine();
  if (m) {
    appendChat(`machine: ${m.name}`, "system");
    void pingHealth().then(() => void refreshTasks());
  } else {
    appendChat("no machines — open Settings to add one", "system");
  }
}

boot();
