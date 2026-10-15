import { UpdateSettings } from "@/components/UpdateNotice";
import {
  CheckCircle2, CircleHelp, Info, Monitor, Moon, Palette, Plus, ScrollText, Sun, SunMoon, Trash2, TriangleAlert, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchHealth } from "@/api/client";
import type { Check, Health } from "@/api/types";
import { Spinner } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnauthorizedError } from "@/lib/auth";
import { deviceNameError, pair, parsePairLink } from "@/lib/pairing";
import { setSecret, vncPasswordAccount } from "@/lib/secrets";
import { cn } from "@/lib/utils";
import { baseUrl, useApp, vncPassword, type Machine, type Theme } from "@/store/app";
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

const defaultDeviceName = () => `mob on ${/Mac/i.test(navigator.userAgent) ? "Mac" : "desktop"}`;

function InsecureWarning() {
  return (
    <p className="flex gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-[11.5px] text-foreground">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
      HTTP link: traffic including the credential is not encrypted. Use it only on a trusted network or a Tailscale/VPN address.
    </p>
  );
}

/** Paste a `mobd link` URL, confirm the target, redeem the invite. Never sends an existing credential. */
function PairForm({ machine, onPaired }: { machine?: Machine; onPaired: (id: string) => void }) {
  const completePairing = useApp((s) => s.completePairing);
  const [link, setLink] = useState("");
  const [officeName, setOfficeName] = useState("Office Mac");
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = useMemo(() => {
    if (!link.trim()) return { error: "" };
    try {
      return { link: parsePairLink(link) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [link]);
  const target = parsed.link;
  const moved = !!machine && !!target && target.origin !== baseUrl(machine);
  const otherOffice = !!machine?.serverId && !!target && target.serverId !== machine.serverId;
  const nameError = deviceNameError(deviceName);
  const ready = !!target && !nameError && (!machine ? !!officeName.trim() : true) && (!moved || confirmed) && !busy;

  useEffect(() => setConfirmed(false), [target?.origin]);

  const submit = async () => {
    if (!target || !ready) return;
    setBusy(true);
    setError("");
    try {
      const paired = await pair(target, deviceName);
      const id = await completePairing({
        id: machine?.id, name: machine?.name ?? officeName, mobdUrl: target.origin, ...paired,
      });
      setLink("");
      onPaired(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      {!machine && (
        <Label>Display name<Input value={officeName} placeholder="Office Mac" onChange={(e) => setOfficeName(e.target.value)} /></Label>
      )}
      <Label>
        Pairing link
        <Input value={link} autoComplete="off" spellCheck={false} placeholder="https://office.example.com/pair#v=1&serverId=…&invite=…"
          onChange={(e) => { setLink(e.target.value); setError(""); }} />
      </Label>
      {!target && (
        <p className="-mt-1.5 text-[11px] text-muted-foreground">
          Run <code className="font-mono">mobd link --url URL</code> on the office Mac and paste the link it prints. A private network,
          VPN or Tailscale address and a self-hosted Tailscale Funnel HTTPS address both work the same way. MOB relay — coming soon.
        </p>
      )}
      {parsed.error && <p className="-mt-1.5 text-xs text-danger">{parsed.error}</p>}
      {target && (
        <div className="grid grid-cols-1 gap-2 rounded-lg border bg-panel p-3">
          <p className="text-xs"><span className="text-muted-foreground">Pair with </span><span className="break-all font-mono font-medium">{target.origin}</span></p>
          {target.insecure && <InsecureWarning />}
          {otherOffice && (
            <p className="text-[11.5px] text-warning">This link belongs to a different office than the one saved for this machine.</p>
          )}
          {moved && (
            <label className="flex items-start gap-2 text-[11.5px]">
              <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>The address changes from <span className="break-all font-mono">{machine?.mobdUrl}</span>. I trust the new address.</span>
            </label>
          )}
        </div>
      )}
      <Label>
        Name of this device
        <Input value={deviceName} maxLength={128} onChange={(e) => setDeviceName(e.target.value)} />
      </Label>
      <p className="-mt-1.5 text-[11px] text-muted-foreground">Shown in the office Mac's list of paired devices.</p>
      <div className="flex items-center gap-2">
        <Button disabled={!ready} onClick={() => void submit()}>{busy && <Spinner />} Pair</Button>
        {target && nameError && <span className="text-xs text-danger">{nameError}</span>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function MachineForm({ machine }: { machine: Machine }) {
  const { saveMachine, deleteMachine, set } = useApp();
  const [form, setForm] = useState({ name: "", vncUsername: "", vncPassword: "" });
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "error"; health?: Health; error?: string }>({ state: "idle" });
  const [saved, setSaved] = useState("");
  const [repair, setRepair] = useState(false);

  useEffect(() => {
    setForm({ name: machine.name, vncUsername: machine.vncUsername ?? "", vncPassword: vncPassword(machine) ?? "" });
    setTest({ state: "idle" });
    setSaved("");
    setRepair(false);
  }, [machine.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const health = await fetchHealth(baseUrl(machine));
      setTest({ state: health.ok ? "ok" : "error", health });
    } catch (err) {
      setTest({
        state: "error",
        error: err instanceof UnauthorizedError ? err.message
          : `${err instanceof Error ? err.message : String(err)} — check the network/VPN and that mobd is running`,
      });
    }
  };

  return (
    <form
      className="grid min-w-0 flex-1 grid-cols-1 content-start gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        saveMachine({ id: machine.id, name: form.name, vncUsername: form.vncUsername });
        setSecret(vncPasswordAccount(machine.id), form.vncPassword)
          .then(() => setSaved("Saved"))
          .catch((err) => setSaved(`Could not save the password to the Keychain: ${String(err)}`));
      }}
    >
      <h3 className="text-[13px] font-semibold">Edit machine</h3>
      <Label>Display name<Input value={form.name} placeholder="Office Mac" onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Label>
      <div className="grid grid-cols-1 gap-2 rounded-lg border bg-panel p-3">
        <div className="flex items-start gap-2 text-xs">
          <span className={cn("mt-1 size-2 shrink-0 rounded-full", machine.needsPairing ? "bg-warning" : "bg-success")} />
          <span className="shrink-0 font-medium">{machine.needsPairing ? "Needs pairing" : "Paired"}</span>
          <span className="min-w-0 flex-1 break-all font-mono text-muted-foreground">{machine.mobdUrl}</span>
          {!machine.needsPairing && !repair && (
            <Button variant="ghost" size="sm" className="-my-1 shrink-0" onClick={() => setRepair(true)}>Pair again</Button>
          )}
        </div>
        {!machine.needsPairing && machine.mobdUrl.startsWith("http:") && <InsecureWarning />}
        {(machine.needsPairing || repair) && (
          <>
            {machine.needsPairing && (
              <p className="text-[11.5px] text-muted-foreground">
                This device has no valid credential for this office Mac. Run <code className="font-mono">mobd link</code> there and paste the new link.
              </p>
            )}
            <PairForm machine={machine} onPaired={() => { setRepair(false); setTest({ state: "idle" }); }} />
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label>macOS user name<Input autoComplete="off" value={form.vncUsername} placeholder="Office Mac account" onChange={(e) => setForm({ ...form, vncUsername: e.target.value })} /></Label>
        <Label>Password<Input type="password" autoComplete="off" value={form.vncPassword} placeholder="Account or VNC password" onChange={(e) => setForm({ ...form, vncPassword: e.target.value })} /></Label>
      </div>
      <p className="-mt-1.5 text-[11px] text-muted-foreground">
        With a user name, the live view signs in to that account like Apple's Screen Sharing and can be controlled. Without it, the
        password is used as a VNC password, which macOS answers with its login window. The password is kept in the Keychain.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={!form.name.trim()}>Save</Button>
        <Button variant="secondary" disabled={machine.needsPairing || test.state === "testing"} onClick={() => void runTest()}>
          {test.state === "testing" && <Spinner />} Test connection
        </Button>
        {saved && <span className={cn("text-xs", saved === "Saved" ? "text-success" : "text-danger")}>{saved}</span>}
        <div className="flex-1" />
        <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => { deleteMachine(machine.id); set({ editMachineId: "" }); }}>
          <Trash2 className="size-3.5" /> Remove
        </Button>
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
  );
}

function MachinesTab() {
  const { machines, editMachineId, selectMachine, set } = useApp();
  const editing = machines.find((m) => m.id === editMachineId);
  return (
    <div className="flex h-full gap-4">
      <div className="flex w-44 shrink-0 flex-col gap-1">
        {machines.map((m) => (
          <button key={m.id} type="button" onClick={() => set({ editMachineId: m.id })}
            className={cn("rounded-md px-2.5 py-1.5 text-left hover:bg-muted", m.id === editMachineId && "bg-muted")}>
            <p className="truncate text-[13px] font-medium">{m.name}</p>
            <p className={cn("truncate text-[11px]", m.needsPairing ? "text-warning" : "text-muted-foreground")}>
              {m.needsPairing ? "Needs pairing" : m.mobdUrl}
            </p>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => set({ editMachineId: "" })}>
          <Plus className="size-3.5" /> Add machine
        </Button>
      </div>
      {editing ? <MachineForm machine={editing} /> : (
        <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-3">
          <h3 className="text-[13px] font-semibold">Add machine</h3>
          <PairForm onPaired={(id) => { set({ editMachineId: id }); selectMachine(id); }} />
        </div>
      )}
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
