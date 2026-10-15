import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchHealth, fetchQueue, supports } from "@/api/client";
import type { Queue, Session } from "@/api/types";
import { chat } from "@/hooks/useChat";
import { streamAuth } from "@/lib/auth";
import { EventStream } from "@/lib/sse";
import { baseUrl, type Machine } from "@/store/app";
import { log } from "@/store/log";

/** Polls /health while the machine is paired; a 401 marks it and stops polling. */
export function useHealth(machine: Machine | null | undefined) {
  const base = baseUrl(machine);
  return useQuery({
    queryKey: ["health", base],
    queryFn: () => fetchHealth(base),
    enabled: !!base && !machine?.needsPairing,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useQueue(base: string, enabled: boolean) {
  return useQuery({ queryKey: ["queue", base], queryFn: () => fetchQueue(base), enabled: !!base && enabled });
}

/** Subscribes to mobd's global stream: sidebar, queue and status stay live without polling. */
export function useMachineEvents(machine: Machine | null | undefined) {
  const qc = useQueryClient();
  const base = baseUrl(machine);
  const { data: health } = useHealth(machine);
  const live = supports(health, "events") && !machine?.needsPairing;
  useEffect(() => {
    if (!base || !live) return;
    // Resume via ?after=: mobd's CORS does not allow a Last-Event-ID header.
    const es = new EventStream(`${base}/events`, { ...streamAuth(base), resumeParam: "after" });
    const on = <T,>(type: string, fn: (data: T) => void) =>
      es.addEventListener(type, (raw) => {
        try {
          fn(JSON.parse(raw.data) as T);
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
