import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Chat } from "@/lib/chat";

/** Draws attention to new questions from the agent: toast, window title, notification. */
export function useQuestionAlerts(chat: Chat): void {
  const seen = useRef(new Set<string>());
  const pending = chat.pendingQuestions;
  const ids = pending.map((q) => q.id).join(",");
  useEffect(() => {
    document.title = pending.length ? `(${pending.length}) Mob — waiting for you` : "Mob";
    for (const q of pending) {
      if (seen.current.has(q.id)) continue;
      seen.current.add(q.id);
      const title = q.kind === "approval" ? "Approval needed" : "The agent asks";
      toast(title, { description: q.text, duration: 8000 });
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`Mob · ${title}`, { body: q.text });
      }
    }
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
