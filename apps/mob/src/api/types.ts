// Mirrors the mobd v3 API (docs/mobd-v3.md).

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

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
}

export interface Health {
  ok: boolean;
  service: string;
  apiVersion: number;
  /** Default runner for new conversations. */
  runner?: string;
  runners?: RunnerInfo[];
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
  runner?: string;
  model?: string;
  effort?: string;
  attachments?: string[];
}
