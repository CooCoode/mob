import { invoke } from "@tauri-apps/api/core";
import { Upload } from "tus-js-client";
import { create } from "zustand";
import { authFetch, responseProblem, UnauthorizedError } from "@/lib/auth";
import { FILE_CHUNK, checkFileRange, tusURL } from "@/lib/filesProtocol";
import { TusHttp } from "@/lib/tusHttp";

export interface RemoteFile { name: string; size: number; modified: string }
export interface FileListing { directory: string; maxUploadSize: number; files: RemoteFile[] }
export interface Transfer {
  id: string; machineId: string; base: string; kind: "upload" | "download";
  name: string; size: number; sha256: string; bytes: number;
  status: "paused" | "running" | "failed" | "ready" | "done";
  url?: string; uploaded?: boolean; etag?: string; message?: string;
}
const storageKey = "mob.fileTransfers.v1";
function restored(): Transfer[] {
  try {
    const tasks = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Transfer[];
    return tasks.filter(t => /^[a-f0-9-]{32,36}$/.test(t.id) && typeof t.base === "string" && typeof t.machineId === "string")
      .map(t => ({ ...t, status: t.status === "running" ? "paused" : t.status }));
  } catch { return []; }
}
export const useTransfers = create<{ tasks: Transfer[] }>(() => ({ tasks: restored() }));
function save(tasks: Transfer[]) {
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  useTransfers.setState({ tasks });
}
function update(id: string, patch: Partial<Transfer>) {
  save(useTransfers.getState().tasks.map(t => t.id === id ? { ...t, ...patch } : t));
}
const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

export async function listFiles(base: string): Promise<FileListing> {
  const res = await authFetch(base, `${base}/files`);
  if (!res.ok) throw await responseProblem(res);
  return res.json();
}

export async function importUpload(machineId: string, base: string) {
  const file = await invoke<Pick<Transfer, "id" | "name" | "size" | "sha256"> | null>("transfer_import");
  if (!file) return;
  try { save([...useTransfers.getState().tasks, { ...file, machineId, base, kind: "upload", bytes: 0, status: "paused" }]); }
  catch (e) { await invoke("transfer_discard", { id: file.id }); throw e; }
  startTransfer(file.id);
}

export function addDownload(machineId: string, base: string, file: RemoteFile) {
  const id = crypto.randomUUID();
  save([...useTransfers.getState().tasks, { id, machineId, base, name: file.name, size: file.size, sha256: "", kind: "download", bytes: 0, status: "paused" }]);
  startTransfer(id);
}

async function uploadFile(task: Transfer, signal: AbortSignal) {
  let url = task.url && tusURL(task.base, task.url);
  if (!task.uploaded) {
    if (await invoke<number>("transfer_size", { id: task.id }) !== task.size ||
        await invoke<string>("transfer_digest", { id: task.id }) !== task.sha256) {
      throw new Error("Local upload copy is missing or changed. Cancel and select the file again.");
    }
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(new Blob(), {
        endpoint: `${task.base}/file-uploads/`, uploadUrl: url,
        uploadSize: task.size, chunkSize: FILE_CHUNK, storeFingerprintForResuming: false,
        metadata: { filename: task.name, sha256: task.sha256 },
        httpStack: new TusHttp(task.base), retryDelays: [0, 1000, 3000],
        onShouldRetry: e => !(e.causingError instanceof UnauthorizedError) &&
          (!e.originalResponse || e.originalResponse.getStatus() >= 500 || e.originalResponse.getStatus() === 409),
        fileReader: { openFile: async () => ({
          size: task.size, close() {},
          slice: async (start: number, end: number) => ({
            value: new Blob([await invoke<ArrayBuffer>("transfer_read", { id: task.id, offset: start, length: Math.min(end, task.size) - start })]),
            done: end >= task.size,
          }),
        }) },
        onUploadUrlAvailable: () => {
          url = tusURL(task.base, upload.url!);
          update(task.id, { url });
        },
        onChunkComplete: (_chunk, bytes) => update(task.id, { bytes }),
        onSuccess: () => { signal.removeEventListener("abort", abort); resolve(); },
        onError: e => { signal.removeEventListener("abort", abort); reject(e); },
      });
      const abort = () => { void upload.abort().then(() => reject(new DOMException("Paused", "AbortError")), reject); };
      signal.addEventListener("abort", abort, { once: true });
      upload.start();
    });
    update(task.id, { uploaded: true, url, bytes: task.size });
  }
  signal.throwIfAborted();
  update(task.id, { message: "Verifying upload…" });
  const res = await authFetch(task.base, `${tusURL(task.base, url!)}/complete`, { method: "POST", signal });
  if (!res.ok) throw await responseProblem(res);
  const result = await res.json() as { name: string; sha256: string; size: number };
  if (result.sha256 !== task.sha256 || result.size !== task.size) throw new Error("Upload verification failed");
  update(task.id, { name: result.name, status: "done", message: undefined });
  await invoke("transfer_discard", { id: task.id });
}

async function downloadFile(task: Transfer, signal: AbortSignal) {
  const url = `${task.base}/files/${encodeURIComponent(task.name)}`;
  let offset = await invoke<number>("transfer_size", { id: task.id });
  const head = await authFetch(task.base, url, { method: "HEAD", signal });
  if (!head.ok) throw await responseProblem(head);
  const size = Number(head.headers.get("Content-Length"));
  const etag = head.headers.get("ETag") ?? "";
  const sha256 = head.headers.get("X-Content-SHA256") ?? "";
  if (!Number.isSafeInteger(size) || size < 0 || !etag || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid file information from mobd");
  if ((task.etag && task.etag !== etag) || offset > size || (offset > 0 && !task.etag)) throw new Error("Remote file changed. Cancel and download the new version.");
  update(task.id, { size, etag, sha256, bytes: offset });
  while (offset < size) {
    signal.throwIfAborted();
    const end = Math.min(offset + FILE_CHUNK, size) - 1;
    const res = await authFetch(task.base, url, { headers: { Range: `bytes=${offset}-${end}`, "If-Match": etag }, signal });
    if (!res.ok) throw await responseProblem(res);
    checkFileRange(res.status, res.headers.get("Content-Range"), res.headers.get("ETag"), etag, offset, end, size);
    if (Number(res.headers.get("Content-Length")) !== end - offset + 1) throw new Error("Invalid download size");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== end - offset + 1) throw new Error("Incomplete download chunk; retry to continue");
    signal.throwIfAborted();
    await invoke("transfer_append", { id: task.id, offset, data: Array.from(bytes) });
    offset += bytes.length;
    update(task.id, { bytes: offset });
  }
  update(task.id, { message: "Verifying download…" });
  if (await invoke<string>("transfer_digest", { id: task.id }) !== sha256) throw new Error("Download checksum mismatch. Cancel and download again.");
  signal.throwIfAborted();
  update(task.id, { status: "ready", message: undefined });
}

export function startTransfer(id: string) {
  if (running.has(id)) return;
  const task = useTransfers.getState().tasks.find(t => t.id === id);
  if (!task || task.status === "done" || task.status === "ready") return;
  const controller = new AbortController();
  update(id, { status: "running", message: undefined });
  const done = (async () => {
    try {
      if (task.kind === "upload") await uploadFile(task, controller.signal);
      else await downloadFile(task, controller.signal);
    } catch (e) {
      const done = useTransfers.getState().tasks.find(t => t.id === id)?.status === "done";
      update(id, { status: done ? "done" : controller.signal.aborted ? "paused" : "failed", message: controller.signal.aborted ? undefined : String(e instanceof Error ? e.message : e) });
    } finally { running.delete(id); }
  })();
  running.set(id, { controller, done });
}

export function pauseTransfer(id: string) { running.get(id)?.controller.abort(); }

export async function cancelTransfer(id: string) {
  const work = running.get(id);
  work?.controller.abort();
  await work?.done;
  const task = useTransfers.getState().tasks.find(t => t.id === id);
  if (!task) return;
  if (task.kind === "upload" && task.url && task.status !== "done") {
    const res = await authFetch(task.base, tusURL(task.base, task.url), { method: "DELETE", headers: { "Tus-Resumable": "1.0.0" } });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw await responseProblem(res);
  }
  await invoke("transfer_discard", { id });
  save(useTransfers.getState().tasks.filter(t => t.id !== id));
}

export async function saveDownload(id: string) {
  const task = useTransfers.getState().tasks.find(t => t.id === id);
  if (!task || task.status !== "ready") return;
  if (await invoke<boolean>("transfer_export", { id, name: task.name })) {
    update(id, { status: "done" });
    await invoke("transfer_discard", { id });
  }
}
