import { Chat, type Session, type TaskStatus } from "./chat";

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
const STORAGE_SESSIONS = "mob.activeSessionByMachine";
const STORAGE_LEGACY_MOBD = "mob.mobdUrl";
const STORAGE_LEGACY_VNC = "mob.vncWsUrl";
const SCREEN_EMPTY =
  "Connect to the office desktop. Mouse and keyboard input is enabled for testing.";
const LOG_MAX = 2000;

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
const settingsLog = document.querySelector<HTMLElement>("#settings-log")!;
const logFilter = document.querySelector<HTMLInputElement>("#log-filter")!;
const paneMachines = document.querySelector<HTMLElement>(
  "#settings-pane-machines",
)!;
const paneLog = document.querySelector<HTMLElement>("#settings-pane-log")!;

const btnSettings =
  document.querySelector<HTMLButtonElement>("#btn-settings")!;
const btnSettingsClose = document.querySelector<HTMLButtonElement>(
  "#btn-settings-close",
)!;
const btnAddMachine =
  document.querySelector<HTMLButtonElement>("#btn-add-machine")!;
const btnNewChat = document.querySelector<HTMLButtonElement>("#btn-new-chat")!;
const chatHeading = document.querySelector<HTMLElement>("#chat-heading")!;
const btnSubmit = document.querySelector<HTMLButtonElement>("#btn-submit")!;
const btnCancel = document.querySelector<HTMLButtonElement>("#btn-cancel")!;
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh")!;
const btnConnect = document.querySelector<HTMLButtonElement>("#btn-connect")!;
const btnDisconnect =
  document.querySelector<HTMLButtonElement>("#btn-disconnect")!;
const btnExpand = document.querySelector<HTMLButtonElement>("#btn-expand")!;
const btnFsExit = document.querySelector<HTMLButtonElement>("#btn-fs-exit")!;
const btnMfPing = document.querySelector<HTMLButtonElement>("#btn-mf-ping")!;
const btnMfNew = document.querySelector<HTMLButtonElement>("#btn-mf-new")!;
const btnLogClear =
  document.querySelector<HTMLButtonElement>("#btn-log-clear")!;

let machines: Machine[] = [];
let activeMachineId: string | null = null;
let collapsedMachines = new Set<string>();
const sessionsByMachine = new Map<string, Session[]>();
let savedSessions: Record<string, string | null> = {};
let renderedConversation = "";
const messageBubbles = new Map<string, HTMLElement>();
let vncClient: SvncClientLike | null = null;
let svncConnect: SvncConnect | null = null;
let svncLoadError: string | null = null;
let previewExpanded = false;
let logFilterText = "";
const chat = new Chat(() => {
  sessionsByMachine.set(chat.machineId, chat.sessions);
  renderChat();
  renderMachineTree();
}, (line) => appendLog(line));

function envDefault(...keys: (keyof ImportMetaEnv)[]): string {
  for (const key of keys) {
    const v = import.meta.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function uid(): string {
  return (
    crypto.randomUUID?.() ??
    `m-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
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

  let mobd = "";
  let vnc = "";
  try {
    mobd = localStorage.getItem(STORAGE_LEGACY_MOBD)?.trim() || "";
    vnc = localStorage.getItem(STORAGE_LEGACY_VNC)?.trim() || "";
  } catch {
    /* ignore */
  }
  mobd =
    mobd || envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";
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

function stamp(): string {
  return new Date().toLocaleTimeString();
}

function scrollChat(): void {
  chatStream.scrollTop = chatStream.scrollHeight;
}

function appendBubble(
  role: "user" | "assistant" | "system",
  text: string,
): HTMLElement {
  const row = document.createElement("div");
  row.className = `bubble-row ${role}`;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  row.appendChild(bubble);
  chatStream.appendChild(row);
  scrollChat();
  return bubble;
}

function appendStatusPill(status: TaskStatus | string): void {
  let row = chatStream.querySelector<HTMLElement>(".chat-status-live");
  if (!row) {
    row = document.createElement("div");
    row.className = "chat-status-live";
    chatStream.appendChild(row);
  }
  row.replaceChildren();
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.dataset.status = status;
  pill.textContent = status;
  row.appendChild(pill);
  chatStream.appendChild(row);
  scrollChat();
}

function clearChat(): void {
  chatStream.replaceChildren();
  messageBubbles.clear();
}

function appendLog(
  line: string,
  kind: "system" | "status" | "error" | "log" | "info" = "log",
): void {
  const p = document.createElement("p");
  p.className = `log-line ${kind}`;
  p.dataset.text = line.toLowerCase();
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = `[${stamp()}]`;
  p.appendChild(ts);
  p.appendChild(document.createTextNode(line));
  if (logFilterText && !line.toLowerCase().includes(logFilterText)) {
    p.hidden = true;
  }
  settingsLog.appendChild(p);
  while (settingsLog.children.length > LOG_MAX) {
    settingsLog.firstElementChild?.remove();
  }
  settingsLog.scrollTop = settingsLog.scrollHeight;
}

function clearLog(): void {
  settingsLog.replaceChildren();
}

function applyLogFilter(): void {
  logFilterText = logFilter.value.trim().toLowerCase();
  for (const el of settingsLog.querySelectorAll<HTMLElement>(".log-line")) {
    const text = el.dataset.text ?? el.textContent?.toLowerCase() ?? "";
    el.hidden = !!(logFilterText && !text.includes(logFilterText));
  }
}

function rememberSession(): void {
  if (!activeMachineId) return;
  savedSessions[activeMachineId] = chat.sessionId;
  try {
    localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(savedSessions));
  } catch { /* ignore unavailable storage */ }
}

function renderChat(): void {
  const key = `${chat.machineId}:${chat.sessionId ?? "new"}`;
  if (key !== renderedConversation) {
    renderedConversation = key;
    clearChat();
  }
  const messages = chat.session?.messages ?? [];
  const lastMessage = new Map<string, string>();
  for (const message of messages) lastMessage.set(message.taskId, message.id);
  const errors = new Map(chat.tasks.filter((t) => t.error).map((t) => [t.id, t.error!]));
  function bubble(id: string, role: "user" | "assistant" | "system", content: string): void {
    let el = messageBubbles.get(id);
    if (!el) {
      el = appendBubble(role, content);
      messageBubbles.set(id, el);
    } else if (el.textContent !== content) {
      el.textContent = content;
    }
  }
  for (const message of messages) {
    bubble(message.id, message.role, message.content);
    if (lastMessage.get(message.taskId) === message.id && errors.has(message.taskId)) {
      bubble(`${message.taskId}:error`, "system", errors.get(message.taskId)!);
    }
  }
  messageBubbles.get("connection-error")?.parentElement?.remove();
  messageBubbles.delete("connection-error");
  if (chat.error) bubble("connection-error", "system", chat.error);
  chatHeading.textContent = chat.session?.title ?? (chat.loading ? "Loading…" : "New chat");
  chatHeading.title = chatHeading.textContent;
  const task = chat.currentTask;
  taskMetaPill.dataset.status = task?.status ?? "none";
  taskMetaPill.textContent = chat.submitting ? "sending" : task?.status ?? "idle";
  taskMetaText.textContent = task ? `${task.id.slice(0, 8)}… · ${task.runner}` : "No active turn";
  btnSubmit.disabled = !chat.canSend;
  btnCancel.disabled = !chat.busy || chat.cancelling;
  btnCancel.textContent = chat.cancelling ? "Cancelling…" : "Cancel";
  btnNewChat.disabled = chat.submitting || chat.loading || !chat.ready;
  if (task) appendStatusPill(task.status);
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

      const newLi = document.createElement("li");
      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.textContent = "+ New chat";
      newBtn.disabled = m.id === activeMachineId && (chat.submitting || chat.loading || !chat.ready);
      if (m.id === activeMachineId && !chat.sessionId) newBtn.classList.add("active");
      newBtn.addEventListener("click", () => {
        if (m.id === activeMachineId) {
          chat.newChat();
          rememberSession();
          promptInput.focus();
        } else void selectMachine(m.id, null);
      });
      newLi.appendChild(newBtn);
      ul.appendChild(newLi);

      for (const session of sessionsByMachine.get(m.id) ?? []) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.id = session.id;
        const selected = m.id === activeMachineId && session.id === chat.sessionId;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-current", selected ? "true" : "false");
        const title = document.createElement("span");
        title.className = "snippet";
        title.textContent = snippet(session.title);
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.dataset.status = session.status;
        pill.textContent = session.status;
        button.append(title, pill);
        button.title = session.title;
        button.addEventListener("click", () => {
          if (m.id === activeMachineId) {
            void chat.open(session.id).then(rememberSession);
          } else void selectMachine(m.id, session.id);
        });
        li.appendChild(button);
        ul.appendChild(li);
      }
      group.appendChild(ul);
    }

    machineTree.appendChild(group);
  }
}

async function selectMachine(id: string, sessionId?: string | null): Promise<void> {
  const machine = machines.find((m) => m.id === id);
  if (!machine) return;
  if (activeMachineId !== id && vncClient) disconnectVnc();
  activeMachineId = id;
  persistMachines();
  appendLog(`selected machine: ${machine.name}`, "info");
  void pingHealth(machine);
  await chat.setMachine(id, baseUrl(machine), sessionId === undefined ? savedSessions[id] : sessionId);
  if (activeMachineId === id && chat.ready) rememberSession();
}

async function loadSvnc(): Promise<void> {
  try {
    const mod = await import("@xrdavies/svnc");
    svncConnect = mod.SVNCClient.connect.bind(mod.SVNCClient) as SvncConnect;
    svncLoadError = null;
  } catch (err) {
    svncConnect = null;
    svncLoadError =
      err instanceof Error ? err.message : "failed to import svnc";
    screenEl.classList.add("stub");
    screenEl.textContent =
      "Could not load @xrdavies/svnc. Run npm install, then retry. You can still dispatch tasks.";
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
    if (body.vncViewUrl) {
      appendLog(`health.vncViewUrl=${body.vncViewUrl}`, "info");
    }
    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (statusEl === healthStatus) {
      healthStatus.textContent = "error";
      setDot(dotOffice, "error");
      appendLog(
        `health failed: ${msg} (if CORS, bind mobd on LAN/VPN and add CORS — see docs)`,
        "error",
      );
    } else {
      mfStatus.textContent = `error: ${msg}`;
    }
    return false;
  }
}

function autoresizePrompt(): void {
  promptInput.style.height = "auto";
  const next = Math.min(Math.max(promptInput.scrollHeight, 40), 200);
  promptInput.style.height = `${next}px`;
}

async function submitTask(): Promise<void> {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  const machineId = activeMachineId;
  if (await chat.submit(prompt)) {
    if (activeMachineId === machineId) {
      rememberSession();
      if (promptInput.value.trim() === prompt) promptInput.value = "";
      autoresizePrompt();
    }
  }
}

function syncVncStatusText(text: string): void {
  vncStatus.textContent = text;
  fsVncStatus.textContent = text;
}

function setVncConnected(on: boolean): void {
  btnConnect.disabled = on;
  btnDisconnect.disabled = !on;
  btnExpand.disabled = !on;
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
      // shortcut: remote input stays enabled for testing, restore viewOnly when testing ends.
      viewOnly: false,
    });
    setVncConnected(true);
    const d = vncClient.desktop;
    syncVncStatusText(
      d
        ? `connected ${d.width}×${d.height} (input enabled)`
        : "connected (input enabled)",
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
  screenEl.querySelector("canvas")?.focus();
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
  const hint = previewPane.querySelector(".hint");
  if (hint) previewPane.insertBefore(screenEl, hint);
  else previewPane.appendChild(screenEl);
  btnExpand.focus();
}

/* —— Settings —— */
function setSettingsTab(tab: "machines" | "log"): void {
  const isMachines = tab === "machines";
  paneMachines.hidden = !isMachines;
  paneLog.hidden = isMachines;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    ".settings-tab",
  )) {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  if (tab === "log") {
    settingsLog.scrollTop = settingsLog.scrollHeight;
  }
}

function openSettings(editId?: string, tab: "machines" | "log" = "machines"): void {
  settingsOverlay.hidden = false;
  settingsOverlay.setAttribute("aria-hidden", "false");
  setSettingsTab(tab);
  renderSettingsList();
  if (editId) fillMachineForm(editId);
  else if (tab === "machines") resetMachineForm();
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
  mfMobd.value =
    envDefault("MOBD_URL", "VITE_MOBD_URL") || "http://127.0.0.1:8080";
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
  if (mfId.value === activeMachineId) {
    void selectMachine(activeMachineId);
  }
}

function deleteMachine(): void {
  const id = mfId.value;
  if (!id) return;
  machines = machines.filter((m) => m.id !== id);
  sessionsByMachine.delete(id);
  delete savedSessions[id];
  if (activeMachineId === id) {
    if (vncClient) disconnectVnc();
    activeMachineId = machines[0]?.id ?? null;
    persistMachines();
    if (activeMachineId) void selectMachine(activeMachineId);
    else { chat.newChat(); chat.ready = false; renderChat(); }
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
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_SESSIONS) ?? "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) savedSessions = saved;
  } catch { /* ignore unavailable storage */ }
  persistMachines();
  renderMachineTree();
  renderChat();
  autoresizePrompt();

  btnSettings.addEventListener("click", () =>
    openSettings(activeMachineId ?? undefined),
  );
  btnSettingsClose.addEventListener("click", () => closeSettings());
  btnAddMachine.addEventListener("click", () => {
    openSettings();
    resetMachineForm();
  });
  settingsOverlay.addEventListener("click", (ev) => {
    if (ev.target === settingsOverlay) closeSettings();
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    ".settings-tab",
  )) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab === "log" ? "log" : "machines";
      setSettingsTab(tab);
    });
  }
  btnLogClear.addEventListener("click", () => clearLog());
  logFilter.addEventListener("input", () => applyLogFilter());

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
  btnNewChat.addEventListener("click", () => {
    chat.newChat();
    rememberSession();
    promptInput.focus();
  });
  btnCancel.addEventListener("click", () => void chat.cancel());
  btnRefresh.addEventListener("click", () => void chat.refresh());
  btnConnect.addEventListener("click", () => void connectVnc());
  btnDisconnect.addEventListener("click", () => disconnectVnc());
  btnExpand.addEventListener("click", () => enterPreviewFullscreen());
  btnFsExit.addEventListener("click", () => exitPreviewFullscreen());

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
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void submitTask();
    }
  });
  promptInput.addEventListener("input", () => autoresizePrompt());

  void loadSvnc().then(() => {
    appendLog(
      svncConnect
        ? "svnc ready (input enabled for testing)"
        : `svnc stub: ${svncLoadError ?? "unavailable"}`,
      "info",
    );
  });

  const m = activeMachine();
  if (m) {
    appendLog(`machine: ${m.name}`, "info");
    void selectMachine(m.id);
  } else {
    appendLog("no machines — open Settings to add one", "info");
    appendBubble("system", "No machines yet — open Settings to add one.");
  }
}

boot();
