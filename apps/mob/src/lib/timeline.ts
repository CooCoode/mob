import type { Activity, ChatMessage, Task } from "../api/types.ts";

// Consecutive steps fold into one expandable group from this many on.
export const GROUP_MIN = 3;

export type TimelineItem =
  | { type: "user"; id: string; message: ChatMessage; task?: Task }
  | { type: "assistant"; id: string; message: ChatMessage }
  | { type: "steps"; id: string; activities: Activity[] }
  | { type: "group"; id: string; activities: Activity[] }
  | { type: "queued"; id: string; task: Task }
  | { type: "working"; id: string; task: Task; latest?: Activity }
  | { type: "footer"; id: string; task: Task };

type Entry = { at: number; order: number; message?: ChatMessage; activity?: Activity };

function time(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/** Builds the conversation timeline: per turn, the prompt, then replies and steps by time. */
export function buildTimeline(tasks: Task[], messages: ChatMessage[], activities: Activity[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const known = new Set(tasks.map((t) => t.id));
  const byTask = new Map<string, { messages: ChatMessage[]; activities: Activity[] }>();
  const bucket = (id: string) => {
    let b = byTask.get(id);
    if (!b) byTask.set(id, (b = { messages: [], activities: [] }));
    return b;
  };
  for (const m of messages) bucket(m.taskId).messages.push(m);
  for (const a of activities) bucket(a.taskId).activities.push(a);
  const orphanTasks = [...byTask.keys()].filter((id) => !known.has(id));

  for (const task of [...tasks, ...orphanTasks.map((id) => ({ id } as Task))]) {
    const b = byTask.get(task.id) ?? { messages: [], activities: [] };
    const user = b.messages.find((m) => m.role === "user") ??
      (task.prompt ? { id: `${task.id}:user`, taskId: task.id, role: "user" as const, content: task.prompt, createdAt: task.createdAt ?? "" } : undefined);
    if (user) items.push({ type: "user", id: user.id, message: user, task: known.has(task.id) ? task : undefined });

    const seenNotices = new Set<string>();
    const entries: Entry[] = [];
    let order = 0;
    for (const m of b.messages) if (m.role === "assistant") entries.push({ at: time(m.createdAt), order: order++, message: m });
    for (const a of b.activities) {
      if (a.kind === "notice") {
        if (seenNotices.has(a.text ?? a.title)) continue;
        seenNotices.add(a.text ?? a.title);
      }
      entries.push({ at: time(a.startedAt), order: order++, activity: a });
    }
    entries.sort((x, y) => x.at - y.at || x.order - y.order);

    let run: Activity[] = [];
    const flush = () => {
      if (run.length >= GROUP_MIN) items.push({ type: "group", id: `${run[0].id}:group`, activities: run });
      else if (run.length) items.push({ type: "steps", id: `${run[0].id}:steps`, activities: run });
      run = [];
    };
    for (const e of entries) {
      if (e.activity) run.push(e.activity);
      else {
        flush();
        items.push({ type: "assistant", id: e.message!.id, message: e.message! });
      }
    }
    flush();

    if (!known.has(task.id)) continue;
    if (task.status === "queued") items.push({ type: "queued", id: `${task.id}:queued`, task });
    else if (task.status === "running") {
      const steps = b.activities.filter((a) => a.kind !== "notice");
      items.push({ type: "working", id: `${task.id}:working`, task, latest: steps[steps.length - 1] });
    } else items.push({ type: "footer", id: `${task.id}:footer`, task });
  }
  return items;
}

export interface ScreenGeometry {
  pointWidth: number;
  pointHeight: number;
}

/** Desktop size in points from the most recent screenshot metadata. */
export function screenGeometry(activities: Activity[]): ScreenGeometry | null {
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i];
    if (a.tool !== "screenshot" || !a.text) continue;
    try {
      const meta = JSON.parse(a.text) as { point_width?: number; point_height?: number };
      if (meta.point_width && meta.point_height) return { pointWidth: meta.point_width, pointHeight: meta.point_height };
    } catch {
      /* not metadata */
    }
  }
  return null;
}

/** The last completed click, in desktop points. */
export function latestClick(activities: Activity[]): { id: string; x: number; y: number } | null {
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i];
    if (a.tool !== "click" || a.status !== "completed") continue;
    const x = Number(a.arguments?.x), y = Number(a.arguments?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { id: a.id, x, y };
  }
  return null;
}
