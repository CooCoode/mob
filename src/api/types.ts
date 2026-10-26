// Mirrors https://github.com/xrdavies/mobd/blob/main/docs/mobd-v3.md.

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type QueueReason = "slots" | "desktops" | "memory" | "disk" | "desktopStarting";

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  costUsd?: number;
}

export interface Task {
  id: string;
  sessionId: string;
  resumeId?: string;
  eventId: number;
  prompt: string;
  status: TaskStatus;
  runner: string;
  model?: string;
  effort?: string;
  attachments?: string[];
  usage?: Usage;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  queuePosition?: number;
  /** Why a queued task still waits (mobd with conversation desktops). */
  queueReason?: QueueReason;
  /** True while the turn waits for the user to answer a question. */
  waiting?: boolean;
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
  /** The runner this conversation is pinned to. */
  runner?: string;
  /** The conversation's model and effort (mobd with "settings"); absent = machine default. */
  model?: string;
  effort?: string;
  resumeId?: string;
  activeTaskId?: string;
  status: TaskStatus;
  pinned?: boolean;
  waiting?: boolean;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  messages?: ChatMessage[];
}

export type ActivityKind = "tool" | "command" | "reasoning" | "plan" | "file_change" | "web_search" | "notice";
export type ActivityStatus = "running" | "completed" | "failed";

export interface Activity {
  id: string;
  taskId: string;
  kind: ActivityKind;
  status: ActivityStatus;
  title: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  command?: string;
  exitCode?: number;
  text?: string;
  truncated?: boolean;
  error?: string;
  images?: string[];
  items?: { text: string; completed: boolean }[];
  changes?: { path: string; kind: string }[];
  startedAt: string;
  updatedAt: string;
}

export type QuestionStatus = "pending" | "answered" | "expired" | "cancelled";

/** A decision the agent asked for (ask_user) or an action awaiting approval (request_approval). */
export interface Question {
  id: string;
  taskId: string;
  kind: "question" | "approval";
  text: string;
  details?: string;
  options?: string[];
  allowText: boolean;
  status: QuestionStatus;
  answer?: string;
  approved?: boolean;
  createdAt: string;
  answeredAt?: string;
}

export interface SessionDetail {
  session: Session;
  tasks: Task[];
  activities?: Activity[];
  questions?: Question[];
  /** The conversation's revision; absent from mobd versions without incremental fetch. */
  rev?: number;
  /** False when this answers `since` with only the turns changed after it. */
  full?: boolean;
}

export interface TaskEvent {
  id: number;
  type: string;
  message?: string;
  messageId?: string;
  role?: "user" | "assistant";
  resumeId?: string;
  status?: TaskStatus;
  activity?: Activity;
  question?: Question;
  usage?: Usage;
  timestamp: string;
}

export interface Check {
  ok: boolean;
  unknown?: boolean;
  detail?: string;
}

export interface RunnerInfo {
  name: string;
  label: string;
  models: string[];
  efforts: string[];
  images: boolean;
  resume: boolean;
  cost: boolean;
  steer?: boolean;
  available: boolean;
  detail?: string;
  default: boolean;
  /** What the agent uses when a turn picks none; absent when unset there or from an older mobd. */
  defaultModel?: string;
  defaultEffort?: string;
  permissions?: Permissions;
}

export type Permissions = "bypass" | "approve";

/** Where a setting's value comes from: an app, mobd's config, the agent's own settings, or none. */
export type SettingFrom = "app" | "config" | "agent" | "builtin";

/** What the apps set for one agent (GET/PUT /settings); absent = not set here. */
export interface AgentSettings {
  models?: string[];
  defaultModel?: string;
  defaultEffort?: string;
  permissions?: Permissions;
}

export interface MachineSettings {
  rev: number;
  defaultAgent?: string;
  agents?: Record<string, AgentSettings>;
}

/** What an agent uses now, and where each value comes from. */
export interface EffectiveAgent {
  models: string[];
  modelsFrom: SettingFrom;
  defaultModel?: string;
  defaultModelFrom: SettingFrom;
  defaultEffort?: string;
  defaultEffortFrom: SettingFrom;
  permissions: Permissions;
  permissionsFrom: SettingFrom;
  efforts: string[];
  /** What applies without the app settings: what clearing a value returns to. */
  fallback?: Omit<EffectiveAgent, "fallback">;
}

export interface SettingsView {
  settings: MachineSettings;
  defaultAgent: string;
  defaultAgentFrom: SettingFrom;
  /** The default agent without the app setting. */
  fallbackDefaultAgent: string;
  agents: Record<string, EffectiveAgent>;
}

export interface Health {
  ok: boolean;
  service: string;
  apiVersion: number;
  /** Default runner for new conversations. */
  runner?: string;
  runners?: RunnerInfo[];
  maxRunning?: number;
  features?: string[];
  models?: string[];
  efforts?: string[];
  checks?: Record<string, Check>;
}

export interface Queue {
  running: Task[];
  queued: Task[];
}

export interface Upload {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface TurnOptions {
  runner?: string;
  model?: string;
  effort?: string;
  attachments?: string[];
}

export type DesktopState = "starting" | "running" | "asleep" | "waking" | "closing" | "closed" | "failed";

/** A conversation's own desktop (mobd on Linux, `sessionDesktops`). */
export interface DesktopInfo {
  sessionId: string;
  title?: string;
  display?: string;
  width: number;
  height: number;
  scale: number;
  state: DesktopState;
  /** Why it closed or failed (archived, deleted, user, crashed…), or `oomKill` when the kernel ended one of its apps. */
  reason?: string;
  memoryBytes: number;
  diskBytes: number;
  startedAt?: string;
  lastUsedAt?: string;
  activeTaskId?: string;
  viewers: number;
}

export type Level = "ok" | "low" | "critical";

export interface MemoryInfo {
  level: Level;
  availableBytes: number;
  totalBytes: number;
  pressure: number;
  warnPercent?: number;
  floorPercent?: number;
}

export interface DiskInfo {
  level: Level;
  freeBytes: number;
  totalBytes: number;
  path?: string;
}

/** GET /desktops: largest memory first; empty with one shared desktop. */
export interface Desktops {
  desktops: DesktopInfo[];
  memory?: MemoryInfo;
  disk?: DiskInfo;
}
