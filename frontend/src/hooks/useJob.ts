import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Job } from "../api/types";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export function useJob(
  jobId: string | null | undefined,
  onDone?: (job: Job) => void,
): Job | null {
  const [job, setJob] = useState<Job | null>(null);
  const doneRef = useRef<string | null>(null);
  const callbackRef = useRef(onDone);
  callbackRef.current = onDone;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    doneRef.current = null;

    const tick = async () => {
      try {
        const next = await api.getJob(jobId);
        if (!active) return;
        setJob(next);
        if (TERMINAL.has(next.status)) {
          const key = `${next.id}:${next.status}`;
          if (doneRef.current !== key) {
            doneRef.current = key;
            callbackRef.current?.(next);
          }
          return;
        }
      } catch {
        // Keep polling quietly; the backend may be restarting.
      }
      if (active) timer = window.setTimeout(tick, 950);
    };

    tick();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId]);

  return job;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · AI Clip Studio` : "AI Clip Studio";
    return () => {
      document.title = "AI Clip Studio";
    };
  }, [title]);
}
