import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchHealth, fetchQueue, supports } from "@/api/client";
import type { Queue, Session } from "@/api/types";
import { chat } from "@/hooks/useChat";
import { log } from "@/store/log";

export function useHealth(base: string) {
  return useQuery({
    queryKey: ["health", base],
    queryFn: () => fetchHealth(base),
    enabled: !!base,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useQueue(base: string, enabled: boolean) {
  return useQuery({ queryKey: ["queue", base], queryFn: () => fetchQueue(base), enabled: !!base && enabled });
}

/** Subscribes to mobd's global stream: sidebar, queue and status stay live without polling. */
export function useMachineEvents(base: string) {
  const qc = useQueryClient();
  const { data: health } = useHealth(base);
  const live = supports(health, "events");
  useEffect(() => {
    if (!base || !live) return;
    const es = new EventSource(`${base}/events`);
    const on = <T,>(type: string, fn: (data: T) => void) =>
      es.addEventListener(type, (raw) => {
        try {
          fn(JSON.parse((raw as MessageEvent<string>).data) as T);
        } catch (err) {
          log(`global event ${type} decode failed: ${String(err)}`, "error");
        }
      });
    on<Session>("session", (s) => chat.applySession(s));
    on<{ id: string }>("session.deleted", ({ id }) => chat.removeSession(id));
    on<Queue>("queue", (q) => {
      qc.setQueryData(["queue", base], q);
      chat.applyQueue(q);
    });
    on<unknown>("reset", () => {
      log("global events reset; refreshing", "info");
      void chat.refresh();
      void qc.invalidateQueries({ queryKey: ["queue", base] });
    });
    // Snapshots may predate the subscription; refetch once it is open.
    es.onopen = () => void qc.invalidateQueries({ queryKey: ["queue", base] });
    return () => es.close();
  }, [base, live, qc]);
}
