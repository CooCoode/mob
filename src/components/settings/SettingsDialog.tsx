import { UpdateSettings } from "@/components/UpdateNotice";
import { CheckCircle2, CircleHelp, Info, Monitor, Moon, Palette, Plus, ScrollText, Sun, SunMoon, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchHealth } from "@/api/client";
import type { Check, Health } from "@/api/types";
import { Spinner } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { defaultMobdUrl, useApp, type Theme } from "@/store/app";
import { useLog } from "@/store/log";

const CHECK_LABELS: Record<string, string> = {
  codex: "Codex CLI",
  actuation: "Desktop actuation",
  accessibility: "Accessibility permission",
  screenRecording: "Screen Recording permission",
  vnc: "VNC server",
};

const order = (key: string) => {
  const i = Object.keys(CHECK_LABELS).indexOf(key);
  return i < 0 ? 99 : i;
};

export function ChecksList({ checks }: { checks?: Record<string, Check> }) {
  if (!checks) return null;
  return (
    <ul className="grid gap-1.5">
      {Object.entries(checks).sort(([a], [b]) => order(a) - order(b)).map(([key, c]) => (
        <li key={key} className="flex gap-2 text-xs">
          {c.unknown ? <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
            : c.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" />
              : <XCircle className="size-4 shrink-0 text-danger" />}
          <div className="min-w-0">
            <p className="font-medium">{CHECK_LABELS[key] ?? key}</p>
            {c.detail && <p className="break-words text-muted-foreground">{c.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MachinesTab() {
  const { machines, editMachineId, saveMachine, deleteMachine, selectMachine, set } = useApp();
  const editing = machines.find((m) => m.id === editMachineId);
  const blank = useMemo(() => ({ name: "", mobdUrl: defaultMobdUrl(), vncUsername: "", vncPassword: "" }), []);
  const [form, setForm] = useState(blank);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "error"; health?: Health; error?: string }>({ state: "idle" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(editing ? { name: editing.name, mobdUrl: editing.mobdUrl, vncUsername: editing.vncUsername ?? "", vncPassword: editing.vncPassword ?? "" } : blank);
    setTest({ state: "idle" });
    setSaved(false);
  }, [editMachineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = form.name.trim() && form.mobdUrl.trim();
  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const health = await fetchHealth(form.mobdUrl.trim().replace(/\/$/, ""));
      setTest({ state: health.ok ? "ok" : "error", health });
    } catch (err) {
      setTest({ state: "error", error: `${err instanceof Error ? err.message : String(err)} — check the URL, network and MOBD_CORS_ORIGINS` });
    }
  };

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-44 shrink-0 flex-col gap-1">
        {machines.map((m) => (
          <button key={m.id} type="button" onClick={() => set({ editMachineId: m.id })}
            className={cn("rounded-md px-2.5 py-1.5 text-left hover:bg-muted", m.id === editMachineId && "bg-muted")}>
            <p className="truncate text-[13px] font-medium">{m.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{m.mobdUrl}</p>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => set({ editMachineId: "" })}>
          <Plus className="size-3.5" /> Add machine
        </Button>
      </div>
      <form
        className="grid min-w-0 flex-1 content-start gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const id = saveMachine({ id: editing?.id, ...form });
          set({ editMachineId: id });
          if (!editing) selectMachine(id);
          setSaved(true);
        }}
      >
        <h3 className="text-[13px] font-semibold">{editing ? "Edit machine" : "New machine"}</h3>
        <Label>Display name<Input value={form.name} placeholder="Office Mac" onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Label>
        <Label>mobd URL<Input value={form.mobdUrl} placeholder="http://192.168.x.x:8080" onChange={(e) => setForm({ ...form, mobdUrl: e.target.value })} required /></Label>
        <div className="grid grid-cols-2 gap-3">
          <Label>macOS user name<Input autoComplete="off" value={form.vncUsername} placeholder="Office Mac account" onChange={(e) => setForm({ ...form, vncUsername: e.target.value })} /></Label>
          <Label>Password<Input type="password" autoComplete="off" value={form.vncPassword} placeholder="Account or VNC password" onChange={(e) => setForm({ ...form, vncPassword: e.target.value })} /></Label>
        </div>
        <p className="-mt-1.5 text-[11px] text-muted-foreground">
          With a user name, the live view signs in to that account like Apple's Screen Sharing and can be controlled. Without it, the
          password is used as a VNC password, which macOS answers with its login window.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={!valid}>{editing ? "Save" : "Add machine"}</Button>
          <Button variant="secondary" disabled={!form.mobdUrl.trim() || test.state === "testing"} onClick={() => void runTest()}>
            {test.state === "testing" && <Spinner />} Test connection
          </Button>
          {saved && <span className="text-xs text-success">Saved</span>}
          <div className="flex-1" />
          {editing && (
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => { deleteMachine(editing.id); set({ editMachineId: "" }); }}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          )}
        </div>
        {test.state === "error" && test.error && <p className="text-xs text-danger">{test.error}</p>}
        {test.health && (
          <div className="rounded-lg border bg-panel p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              mobd API v{test.health.apiVersion}{test.health.apiVersion < 3 && " — update the office daemon for activities, queue and uploads"}
            </p>
            <ChecksList checks={test.health.checks} />
          </div>
        )}
      </form>
    </div>
  );
}

function AppearanceTab() {
  const { theme, set } = useApp();
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "System", icon: SunMoon },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <div className="grid gap-2">
      <h3 className="text-[13px] font-semibold">Theme</h3>
      <div className="grid w-fit grid-cols-3 gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => set({ theme: o.value })}
            className={cn("flex w-28 flex-col items-center gap-1.5 rounded-lg border p-3 text-xs hover:bg-muted", theme === o.value && "border-accent bg-accent-soft")}>
            <o.icon className="size-4" /> {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NotificationsSetting() {
  const supported = typeof Notification !== "undefined";
  const [perm, setPerm] = useState(supported ? Notification.permission : "denied");
  return (
    <div className="grid gap-2">
      <h3 className="text-[13px] font-semibold">Notifications</h3>
      <p className="text-xs text-muted-foreground">Get a system notification when the agent asks you something while mob is in the background.</p>
      {perm === "granted" ? (
        <p className="text-xs text-success">Enabled</p>
      ) : (
        <Button variant="secondary" className="w-fit" disabled={!supported || perm === "denied"}
          onClick={() => void Notification.requestPermission().then(setPerm)}>
          {perm === "denied" ? "Blocked in system settings" : "Enable notifications"}
        </Button>
      )}
    </div>
  );
}

function LogTab() {
  const { lines, clear } = useLog();
  const [filter, setFilter] = useState("");
  const shown = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : lines;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-2">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(shown.map((l) => `[${l.at}] ${l.text}`).join("\n"))}>Copy</Button>
        <Button variant="secondary" onClick={clear}>Clear</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-code p-2 font-mono text-[11px] leading-relaxed">
        {shown.length === 0 && <p className="text-muted-foreground">Event stream and debug lines appear here. The chat stays clean.</p>}
        {shown.map((l) => (
          <p key={l.id} className={cn("break-all", l.kind === "error" && "text-danger", l.kind === "info" && "text-accent")}>
            <span className="text-muted-foreground">[{l.at}]</span> {l.text}
          </p>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const { settingsOpen, settingsTab, set } = useApp();
  const tabs = [
    { value: "machines", label: "Machines", icon: Monitor },
    { value: "appearance", label: "Appearance", icon: Palette },
    { value: "log", label: "Log", icon: ScrollText },
    { value: "about", label: "About", icon: Info },
  ] as const;
  return (
    <Dialog open={settingsOpen} onOpenChange={(o) => set({ settingsOpen: o })}>
      <DialogContent className="flex h-[560px] w-[760px] max-w-[94vw] overflow-hidden p-0">
        <Tabs value={settingsTab} onValueChange={(v) => set({ settingsTab: v as typeof settingsTab })} orientation="vertical" className="flex w-full">
          <div className="w-44 shrink-0 border-r bg-panel p-2">
            <DialogTitle className="px-2.5 pb-2 pt-1.5">Settings</DialogTitle>
            <DialogDescription className="sr-only">Machines, appearance and logs</DialogDescription>
            <TabsList>
              {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}><t.icon /> {t.label}</TabsTrigger>)}
            </TabsList>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5 pt-11">
            <TabsContent value="machines"><MachinesTab /></TabsContent>
            <TabsContent value="appearance"><div className="grid gap-6"><AppearanceTab /><NotificationsSetting /></div></TabsContent>
            <TabsContent value="log" className="h-full"><LogTab /></TabsContent>
            <TabsContent value="about">
              <div className="grid gap-1 text-[13px]">
                <img src="/logo.svg" alt="mob Screen Buddy" className="mb-2 size-20" />
                <p className="font-semibold">mob</p>
                <p className="text-muted-foreground">Home client for the MOB office agent</p>
                <p className="text-muted-foreground">Desktop view by svnc · MIT</p>
                <UpdateSettings />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
