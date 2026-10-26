import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useState, type ComponentProps } from "react";
import { fetchSettings, saveSettings, supports } from "@/api/client";
import { Spinner } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useHealth } from "@/hooks/useMachine";
import { ApiError } from "@/lib/auth";
import { addModel, fromLabel, newlyUnguarded, withAgent, type SettingsEdit } from "@/lib/turnSettings";
import { cn } from "@/lib/utils";
import { baseUrl, useActiveMachine } from "@/store/app";

function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn("h-8 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:border-accent", className)} {...props} />;
}

const PERMISSIONS = { bypass: "Run without asking", approve: "Ask before commands and edits" } as const;

/** Machine settings shared by every device: default agent, and per agent models, defaults, permissions. */
export function AgentsTab() {
  const machine = useActiveMachine();
  const base = baseUrl(machine);
  const { data: health } = useHealth(machine);
  const qc = useQueryClient();
  const enabled = !!base && !machine?.needsPairing && supports(health, "settings");
  const { data: view, error, refetch } = useQuery({ queryKey: ["settings", base], queryFn: () => fetchSettings(base), enabled });
  const [edit, setEdit] = useState<SettingsEdit | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error" | "confirm"; text?: string; agents?: string[] }>({ kind: "idle" });

  // Start from mobd's copy, again whenever another device saved.
  useEffect(() => {
    if (view && (!edit || edit.rev !== view.settings.rev)) setEdit(structuredClone(view.settings));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!machine) return <p className="text-xs text-muted-foreground">Add a machine first.</p>;
  if (health && !supports(health, "settings")) {
    return <p className="text-xs text-muted-foreground">Update mobd on {machine.name} to change its agent settings from here.</p>;
  }
  if (error) return <p className="text-xs text-danger">{(error as Error).message}</p>;
  if (!view || !edit) return <Spinner />;

  // What each value returns to when it is cleared here.
  const configured = Object.fromEntries(Object.entries(view.agents).map(([n, a]) => [n, (a.fallback ?? a).permissions]));
  const save = async (confirmed = false) => {
    const risky = newlyUnguarded(view.agents, edit, configured);
    if (risky.length && !confirmed) return setStatus({ kind: "confirm", agents: risky });
    setStatus({ kind: "saving" });
    try {
      const saved = await saveSettings(base, edit);
      qc.setQueryData(["settings", base], saved);
      void qc.invalidateQueries({ queryKey: ["health", base] });
      setEdit(structuredClone(saved.settings));
      setStatus({ kind: "saved", text: "Saved. New chats use these defaults; open chats keep theirs." });
    } catch (err) {
      if (err instanceof ApiError && err.code === "settings_changed") {
        await refetch();
        return setStatus({ kind: "error", text: "Another device changed these settings. They are reloaded; make your change again." });
      }
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };
  const label = (name: string) => health?.runners?.find((r) => r.name === name)?.label ?? name;

  return (
    <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-1">
      <div>
        <h3 className="text-[13px] font-semibold">Agents on {machine.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Shared by every device paired with this machine. Each chat keeps the model and effort it started with; change them for one chat in its message box.</p>
      </div>
      <Label>
        Default agent for new chats
        <Select value={edit.defaultAgent ?? ""} onChange={(e) => setEdit({ ...edit, defaultAgent: e.target.value || undefined })}>
          <option value="">{label(view.fallbackDefaultAgent)} ({fromLabel("config")})</option>
          {Object.keys(view.agents).map((n) => <option key={n} value={n}>{label(n)}</option>)}
        </Select>
      </Label>
      {Object.entries(view.agents).map(([name, now]) => {
        const a = edit.agents?.[name] ?? {};
        const back = now.fallback ?? now;
        const models = a.models ?? back.models;
        const modelsSet = a.models !== undefined;
        const fallback = (value: string | undefined, from: string) => (value ? `${value} (${fromLabel(from)})` : fromLabel("builtin"));
        return (
          <section key={name} className="grid gap-3 rounded-lg border bg-panel p-3">
            <h4 className="text-[13px] font-semibold">{label(name)}</h4>
            <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              <span>Models offered {!modelsSet && `(${fromLabel(back.modelsFrom)})`}</span>
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
                <Select value={a.defaultModel ?? ""} onChange={(e) => setEdit(withAgent(edit, name, { defaultModel: e.target.value }))}>
                  <option value="">{fallback(back.defaultModel, back.defaultModelFrom)}</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Label>
              <Label>
                Default effort
                <Select value={a.defaultEffort ?? ""} onChange={(e) => setEdit(withAgent(edit, name, { defaultEffort: e.target.value }))}>
                  <option value="">{fallback(back.defaultEffort, back.defaultEffortFrom)}</option>
                  {now.efforts.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Label>
              <Label>
                Permissions
                <Select value={a.permissions ?? ""} onChange={(e) => setEdit(withAgent(edit, name, { permissions: e.target.value }))}>
                  <option value="">{PERMISSIONS[configured[name] as keyof typeof PERMISSIONS] ?? configured[name]} ({fromLabel("config")})</option>
                  {Object.entries(PERMISSIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Label>
            </div>
          </section>
        );
      })}
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
        <Button disabled={status.kind === "saving"} onClick={() => void save()}>{status.kind === "saving" && <Spinner />} Save</Button>
        <Button variant="ghost" onClick={() => { setEdit(structuredClone(view.settings)); setStatus({ kind: "idle" }); }}>Discard changes</Button>
        {status.text && <span className={cn("text-xs", status.kind === "saved" ? "text-success" : "text-danger")}>{status.text}</span>}
      </div>
    </div>
  );
}
