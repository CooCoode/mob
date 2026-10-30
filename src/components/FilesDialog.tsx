import { useEffect, useState } from "react";
import { Copy, Download, RefreshCw, Upload } from "lucide-react";
import type { Health } from "@/api/types";
import { supports } from "@/api/client";
import { isTauri } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { baseUrl, type Machine } from "@/store/app";
import { addDownload, cancelTransfer, importUpload, listFiles, pauseTransfer, saveDownload, startTransfer, useTransfers, type FileListing } from "@/store/transfers";

const size = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024 ** 3).toFixed(2)} GiB`;

export function FilesDialog({ machine, health, open, onOpenChange }: { machine: Machine; health?: Health; open: boolean; onOpenChange: (open: boolean) => void }) {
  const base = baseUrl(machine);
  const enabled = supports(health, "fileTransfers");
  const tasks = useTransfers(s => s.tasks).filter(t => t.machineId === machine.id && t.base === base);
  const [listing, setListing] = useState<FileListing>();
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const completed = tasks.filter(t => t.status === "done").length;
  const action = async (work: () => Promise<unknown>) => { setError(""); try { await work(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } };
  const refresh = () => action(async () => setListing(await listFiles(base)));
  useEffect(() => {
    let active = true;
    setListing(undefined);
    if (open && enabled) void listFiles(base).then(v => { if (active) setListing(v); }, e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [base, open, enabled, completed]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85vh] w-[min(720px,94vw)] flex-col gap-4 p-5">
      <DialogTitle>Files · {machine.name}</DialogTitle>
      <DialogDescription>Exchange files with this machine. Uploaded files stay here when a chat is deleted.</DialogDescription>
      {!enabled ? <p className="text-sm">Update mobd to a version with file transfers, then reconnect.</p> : <>
        {listing && <div className="flex items-center gap-2 rounded border p-2">
          <code className="min-w-0 flex-1 break-all text-xs">{listing.directory}</code>
          <Button variant="ghost" size="icon-sm" aria-label="Copy remote directory" onClick={() => void action(() => navigator.clipboard.writeText(listing.directory))}><Copy /></Button>
        </div>}
        <p className="text-xs text-muted-foreground">To download a file from another directory, ask your agent to copy it into the directory shown above.</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!isTauri || preparing} onClick={() => void action(async () => { setPreparing(true); try { await importUpload(machine.id, base); } finally { setPreparing(false); } })}>
            <Upload /> {preparing ? "Preparing upload…" : "Upload file"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}><RefreshCw /> Refresh</Button>
        </div>
        {!isTauri && <p className="text-xs text-muted-foreground">Use the desktop app to select and save local files.</p>}
        {error && <p role="alert" className="break-words text-sm text-danger">{error}</p>}
        <div className="min-h-0 overflow-y-auto">
          <ul className="divide-y">
            {listing?.files.map(file => <li key={file.name} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 break-all text-sm">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{size(file.size)}</span>
              <Button variant="ghost" size="icon-sm" disabled={!isTauri} aria-label={`Download ${file.name}`} onClick={() => addDownload(machine.id, base, file)}><Download /></Button>
            </li>)}
          </ul>
          {listing?.files.length === 0 && <p className="py-5 text-center text-sm text-muted-foreground">No files yet</p>}
          {tasks.length > 0 && <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-sm font-medium">Transfers</p>
            <ul className="space-y-3">{tasks.map(task => <li key={task.id} className="rounded border p-3">
              <p className="break-all text-sm">{task.kind === "upload" ? "↑" : "↓"} {task.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{size(task.bytes)} / {size(task.size)} · {task.status === "ready" ? "Ready to save" : task.status}</p>
              {task.status === "running" && <progress aria-label={`Progress for ${task.name}`} className="mt-2 h-1 w-full" value={task.bytes} max={Math.max(1, task.size)} />}
              {task.message && <p className="mt-1 break-words text-xs" role={task.status === "failed" ? "alert" : "status"}>{task.message}</p>}
              <div className="mt-2 flex gap-2">
                {task.status === "running" && <Button variant="secondary" size="sm" onClick={() => pauseTransfer(task.id)}>Pause</Button>}
                {(task.status === "paused" || task.status === "failed") && <Button variant="secondary" size="sm" onClick={() => startTransfer(task.id)}>{task.status === "failed" ? "Retry" : "Continue"}</Button>}
                {task.status === "ready" && <Button size="sm" onClick={() => void action(() => saveDownload(task.id))}>Save…</Button>}
                <Button variant="ghost" size="sm" onClick={() => void action(() => cancelTransfer(task.id))}>{task.status === "done" ? "Dismiss" : "Cancel"}</Button>
              </div>
            </li>)}</ul>
          </div>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
