import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { classifyLink } from "@/lib/links";

const errorText = (err: unknown) => err instanceof Error ? err.message : String(err);

/** Explicit desktop actions; no Markdown destination is handed to the webview as a file URL. */
export function MarkdownLink({ href, children }: { href: string; children: ReactNode }) {
  const target = classifyLink(href);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const desktop = isTauri();

  if (target.kind === "anchor") return <a href={target.href}>{children}</a>;
  if (target.kind === "web") {
    return <>
      <a href={target.url} target="_blank" rel="noreferrer" onClick={desktop ? (event) => {
        event.preventDefault();
        setError("");
        void openUrl(target.url).catch((err) => setError(`Could not open link: ${errorText(err)}`));
      } : undefined}>{children}</a>
      {error && <span role="alert" className="ml-2 text-xs text-danger">{error}</span>}
    </>;
  }

  const file = target.kind === "file";
  const copy = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(file ? target.path : target.display);
      setCopied(true);
    } catch (err) {
      setError(`Could not copy: ${errorText(err)}`);
    }
  };
  const native = async (reveal: boolean) => {
    if (!file || !desktop) return;
    setBusy(true);
    setError("");
    try {
      await invoke("open_local_path", { path: target.path, reveal });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <a href="#mob-file-link" onClick={(event) => {
      event.preventDefault();
      setError("");
      setCopied(false);
      setDialog(true);
    }}>{children}</a>
    <Dialog open={dialog} onOpenChange={setDialog}>
      <DialogContent className="w-[min(500px,calc(100vw-32px))] p-5">
        <DialogTitle>{file ? "Local file link" : "Link cannot be opened"}</DialogTitle>
        <DialogDescription className="mt-2">
          {file
            ? "Open this path on the device running Mob. The file may only exist on the office machine."
            : target.reason}
          {file && !desktop && " Use the desktop app to open local files; you can copy the path here."}
        </DialogDescription>
        <div className="mt-4 break-all rounded-md border bg-muted/40 p-2.5 font-mono text-xs">{target.display}</div>
        {error && <p role="alert" className="mt-3 break-words text-xs text-danger">{error}</p>}
        {copied && <p role="status" className="mt-3 text-xs text-muted-foreground">Path copied</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => void copy()}><Copy />Copy path</Button>
          {file && desktop && <>
            <Button variant="secondary" disabled={busy} onClick={() => void native(true)}><FolderOpen />Show in file manager</Button>
            <Button disabled={busy} onClick={() => void native(false)}><ExternalLink />Open on this device</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
