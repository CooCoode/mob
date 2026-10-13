// Mirrors the mobd v3 API (docs/mobd-v3.md).

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface Task {
  id: string;
  sessionId: string;
  threadId?: string;
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
  threadId?: string;
  activeTaskId?: string;
  status: TaskStatus;
  pinned?: boolean;
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

export interface SessionDetail {
  session: Session;
  tasks: Task[];
  activities?: Activity[];
}

export interface TaskEvent {
  id: number;
  type: string;
  message?: string;
  messageId?: string;
  threadId?: string;
  status?: TaskStatus;
  activity?: Activity;
  usage?: Usage;
  timestamp: string;
}

export interface Check {
  ok: boolean;
  unknown?: boolean;
  detail?: string;
}

export interface Health {
  ok: boolean;
  service: string;
  apiVersion: number;
  runner?: string;
  vncViewUrl?: string;
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
  model?: string;
  effort?: string;
  attachments?: string[];
}
