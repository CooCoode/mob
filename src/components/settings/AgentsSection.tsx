import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { fetchSettings, saveSettings } from "@/api/client";
import { Spinner } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ApiError } from "@/lib/auth";
import { addModel, agentStateLabel, newlyUnguarded, withAgent, type AgentEdit, type SettingsEdit } from "@/lib/turnSettings";
import { cn } from "@/lib/utils";
import { baseUrl, useApp, type Machine } from "@/store/app";

function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn("h-8 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:border-accent", className)} {...props} />;
}

const PERMISSIONS = { bypass: "Run without asking", approve: "Ask before commands and edits" } as const;

/**
 * One machine's agents (its mobd's settings.json, shared by every device): default agent, and per
 * agent models, defaults, permissions. Works for any paired machine, not only the active one.
 */
export function AgentsSection({ machine }: { machine: Machine }) {
  const base = baseUrl(machine);
  const focus = useApp((s) => s.settingsFocus);
  const root = useRef<HTMLElement>(null);
  const qc = useQueryClient();
  const enabled = !!base && !machine?.needsPairing;
  const { data: view, error, refetch } = useQuery({ queryKey: ["settings", base], queryFn: () => fetchSettings(base), enabled });
  const [edit, setEdit] = useState<SettingsEdit | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error" | "confirm"; text?: string; agents?: string[] }>({ kind: "idle" });

  // Start from mobd's copy, again whenever another device saved.
  useEffect(() => {
    if (view && (!edit || edit.rev !== view.settings.rev)) setEdit(structuredClone(view.settings));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a chat's model menu: bring this machine's agent into view.
  useEffect(() => {
    if (focus === null || !view) return;
    const target = (focus && root.current?.querySelector(`[data-agent="${focus}"]`)) || root.current;
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    useApp.getState().set({ settingsFocus: null });
  }, [focus, view]);

  const heading = <h3 className="text-[13px] font-semibold">{machine.name} · Agents</h3>;
  const note = (text: string, danger = false) => (
    <section ref={root} className="grid gap-1.5">{heading}<p className={cn("text-xs", danger ? "text-danger" : "text-muted-foreground")}>{text}</p></section>
  );
  if (machine.needsPairing) return note(`Pair ${machine.name} again to change its agents.`);
  if (error) {
    // fetch rejects with a TypeError when the machine cannot be reached.
    return error instanceof TypeError
      ? note(`Connect to ${machine.name} to change its agents.`)
      : note((error as Error).message, true);
  }
  if (!view || !edit) return <section ref={root} className="grid gap-1.5">{heading}<Spinner /></section>;

  const save = async (confirmed = false) => {
    const risky = newlyUnguarded(view.settings, edit);
    if (risky.length && !confirmed) return setStatus({ kind: "confirm", agents: risky });
    setStatus({ kind: "saving" });
    try {
      const saved = await saveSettings(base, edit);
      qc.setQueryData(["settings", base], saved);
      void qc.invalidateQueries({ queryKey: ["health", base] });
      setEdit(structuredClone(saved.settings));
      // The button shows ✓ Saved for a moment, then is greyed out until the next change.
      setStatus({ kind: "saved" });
      setTimeout(() => setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s)), 2000);
    } catch (err) {
      if (err instanceof ApiError && err.code === "settings_changed") {
        await refetch();
        return setStatus({ kind: "error", text: "Another device changed these settings. They are reloaded; make your change again." });
      }
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };
  const changed = JSON.stringify(edit) !== JSON.stringify(view.settings);
  const label = (name: string) => view.agents[name]?.label ?? name;
  // An empty default sends none: the agent's own applies.
  const agentDefault = (value?: string) => (value ? `Agent's default (${value})` : "Agent's default");

  return (
    <section ref={root} className="grid content-start gap-4">
      <div>
        {heading}
        <p className="mt-1 text-xs text-muted-foreground">Shared by every device paired with this machine. Each chat keeps the model and effort it started with; change them for one chat in its message box.</p>
      </div>
      <Label>
        Default agent for new chats
        <Select value={edit.defaultAgent} onChange={(e) => setEdit({ ...edit, defaultAgent: e.target.value })}>
          {Object.keys(view.agents).map((n) => <option key={n} value={n}>{label(n)}</option>)}
        </Select>
      </Label>
      {Object.entries(view.agents).map(([name, info]) => {
        const a = edit.agents[name];
        if (!a) return null;
        const models = a.models;
        return (
          <section key={name} data-agent={name} className="grid scroll-mt-2 gap-3 rounded-lg border bg-panel p-3">
            <h4 className="text-[13px] font-semibold">{label(name)}</h4>
            <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              <span>Models offered</span>
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <span key={m} className="flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 font-mono text-[12px] text-foreground">
                    {m}
                    <button type="button" aria-label={`Remove ${m}`} className="rounded-full p-0.5 hover:bg-muted"
                      onClick={() => setEdit(withAgent(edit, name, { models: models.filter((x) => x !== m), ...(a.defaultModel === m ? { defaultModel: "" } : {}) }))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {models.length === 0 && <span className="font-normal">None listed: chats use the default model.</span>}
              </div>
              <form className="flex gap-1.5" onSubmit={(e) => {
                e.preventDefault();
                const next = addModel(models, adding[name] ?? "");
                if (typeof next === "string") return setStatus({ kind: "error", text: next });
                setEdit(withAgent(edit, name, { models: next }));
                setAdding({ ...adding, [name]: "" });
                setStatus({ kind: "idle" });
              }}>
                <Input value={adding[name] ?? ""} placeholder="Add a model ID, e.g. gpt-5.4 or claude-opus-5-5" className="font-mono"
                  onChange={(e) => setAdding({ ...adding, [name]: e.target.value })} />
                <Button type="submit" variant="secondary" size="sm" disabled={!(adding[name] ?? "").trim()}><Plus className="size-3.5" /> Add</Button>
              </form>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Label>
                Default model
                <Select value={a.defaultModel} onChange={(e) => setEdit(withAgent(edit, name, { defaultModel: e.target.value }))}>
                  <option value="">{agentDefault(info.agentDefaultModel)}</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Label>
              <Label>
                Default effort
                <Select value={a.defaultEffort} onChange={(e) => setEdit(withAgent(edit, name, { defaultEffort: e.target.value }))}>
                  <option value="">{agentDefault(info.agentDefaultEffort)}</option>
                  {info.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Label>
              <Label>
                Permissions
                <Select value={a.permissions} onChange={(e) => setEdit(withAgent(edit, name, { permissions: e.target.value as AgentEdit["permissions"] }))}>
                  {Object.entries(PERMISSIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Label>
            </div>
          </section>
        );
      })}
      {(view.installed ?? []).some((a) => a.state !== "ready") && (
        <section className="grid gap-2 rounded-lg border bg-panel p-3">
          <h4 className="text-[13px] font-semibold">Other agents</h4>
          {(view.installed ?? []).filter((a) => a.state !== "ready").map((a) => (
            <div key={a.name} className="grid gap-1 text-xs">
              <p><span className="font-medium text-foreground">{a.label}</span> · <span className={a.state === "error" ? "text-danger" : "text-muted-foreground"}>{agentStateLabel(a.state)}</span></p>
              {a.detail && <p className="break-all text-muted-foreground">{a.detail}</p>}
              {a.install && (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1 font-mono text-[11.5px]">{a.install}</code>
                  <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(a.install!)}>Copy</Button>
                </div>
              )}
            </div>
          ))}
          <p className="text-[11.5px] text-muted-foreground">Install on {machine.name}, add the agent to <code className="font-mono">runners</code> in mobd&apos;s config.json, then run <code className="font-mono">mobd restart</code>.</p>
        </section>
      )}
      {status.kind === "confirm" && (
        <div className="grid gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <p><strong>{status.agents!.map(label).join(", ")}</strong> will run commands and edit files on {machine.name} without asking you first.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save(true)}>Allow and save</Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus({ kind: "idle" })}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button className={cn(status.kind === "saved" && "disabled:opacity-100 text-success")} disabled={!changed || status.kind === "saving" || status.kind === "saved"} onClick={() => void save()}>
          {status.kind === "saving" ? <><Spinner /> Saving…</> : status.kind === "saved" ? <><Check className="size-3.5" /> Saved</> : "Save"}
        </Button>
        <Button variant="ghost" disabled={!changed || status.kind === "saving"} onClick={() => { setEdit(structuredClone(view.settings)); setStatus({ kind: "idle" }); }}>Discard changes</Button>
        {status.kind === "error" && status.text && <span className="text-xs text-danger">{status.text}</span>}
      </div>
    </section>
  );
}
