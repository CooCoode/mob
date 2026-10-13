import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { supports } from "@/api/client";
import { CommandPalette } from "@/components/CommandPalette";
import { Composer } from "@/components/composer/Composer";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Timeline } from "@/components/timeline/Timeline";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { chat, useChat } from "@/hooks/useChat";
import { useHealth, useMachineEvents, useQueue } from "@/hooks/useMachine";
import { useQuestionAlerts } from "@/hooks/useQuestionAlerts";
import { vnc } from "@/lib/vnc";
import { baseUrl, useActiveMachine, useApp, vncUrl } from "@/store/app";
import { useComposer } from "@/store/composer";
import { log } from "@/store/log";

function useDarkMode(): boolean {
  const theme = useApp((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return dark;
}

function NoMachine() {
  const openSettings = useApp((s) => s.openSettings);
  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <div className="w-[380px] rounded-2xl border bg-background p-6 text-center shadow-panel">
        <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Monitor className="size-5" />
        </div>
        <h2 className="mt-3 text-base font-semibold">Connect your office Mac</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Paste the mobd URL of the office Mac. The live view goes through mobd too. You can test the connection before saving.
        </p>
        <Button className="mt-4" onClick={() => useApp.setState({ settingsOpen: true, settingsTab: "machines", editMachineId: "" })}>
          Add machine
        </Button>
        <Button variant="link" className="mt-1 w-full" onClick={() => openSettings("about")}>What is mob?</Button>
      </div>
    </div>
  );
}

export default function App() {
  const machine = useActiveMachine();
  const { sidebarOpen, previewOpen, fullscreen, savedSessions, rememberSession, set } = useApp();
  const chatState = useChat();
  const base = baseUrl(machine);
  const health = useHealth(base);
  const { data: queue } = useQueue(base, supports(health.data, "queue"));
  const dark = useDarkMode();
  useMachineEvents(base);
  useQuestionAlerts(chatState);

  // Load the selected machine's conversations; restore its last session.
  useEffect(() => {
    if (!machine) {
      chat.newChat();
      return;
    }
    log(`selected machine: ${machine.name}`, "info");
    void chat.setMachine(machine.id, base, useApp.getState().savedSessions[machine.id]);
  }, [machine?.id, base]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (machine && chatState.ready && chatState.machineId === machine.id && savedSessions[machine.id] !== chatState.sessionId) {
      rememberSession(machine.id, chatState.sessionId);
    }
  }, [chatState.sessionId, chatState.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectVnc = () => {
    const host = document.querySelector<HTMLElement>(".vnc-host");
    if (machine && host) void vnc.connect(host, vncUrl(machine), machine.vncPassword, machine.vncUsername);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const st = useApp.getState();
      if (e.key === "Escape" && st.fullscreen) {
        e.preventDefault();
        set({ fullscreen: false });
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ paletteOpen: !st.paletteOpen });
      } else if (mod && e.key.toLowerCase() === "n" && chat.ready && !chat.submitting) {
        e.preventDefault();
        chat.newChat();
        useComposer.getState().focus();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        set(e.shiftKey ? { previewOpen: !st.previewOpen } : { sidebarOpen: !st.sidebarOpen });
      } else if (mod && e.key === ",") {
        e.preventDefault();
        st.openSettings();
      } else if (mod && /^[1-9]$/.test(e.key)) {
        const s = chat.sessions[Number(e.key) - 1];
        if (s) {
          e.preventDefault();
          void chat.open(s.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <TitleBar machine={machine} health={health.data} healthError={health.isError} queue={queue}
          refetchHealth={() => void health.refetch()} dark={dark} />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && <Sidebar />}
          {machine ? (
            <main className="flex min-w-0 flex-1 flex-col bg-background">
              <div className="flex h-10 shrink-0 items-center border-b px-4">
                <h1 className="min-w-0 truncate text-[13px] font-medium">
                  {chatState.session?.title ?? (chatState.loading ? "Loading…" : "New chat")}
                </h1>
              </div>
              <Timeline machineName={machine.name} />
              <Composer machineId={machine.id} machineName={machine.name} health={health.data} />
            </main>
          ) : (
            <NoMachine />
          )}
          {machine && <PreviewPanel machine={machine} health={health.data} queue={queue} hidden={!previewOpen && !fullscreen} />}
        </div>
      </div>
      <SettingsDialog />
      <CommandPalette onConnect={connectVnc} />
      <Toaster theme={dark ? "dark" : "light"} position="bottom-center" />
    </TooltipProvider>
  );
}
