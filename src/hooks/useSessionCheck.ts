import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeToJob } from "../lib/api";
import type { Job, LogEntry } from "../lib/types";
import { classifyJobError, type ClassifiedError } from "../lib/errors";

export type SessionCheckStatus =
  | "idle"
  | "checking"
  | "verified"
  | "unauth"
  | "error";

export interface UseSessionCheck {
  status: SessionCheckStatus;
  checkedAt: Date | null;
  classifiedError: ClassifiedError | null;
  /** True while a check is in-flight (mirrors status === "checking" but easier to read). */
  busy: boolean;
  run: () => Promise<void>;
  dismissError: () => void;
}

/**
 * Runs Blackboard `check-session` independently of the main job pipeline.
 *
 * Does **not** touch sessionStorage and **does not** dispatch through `useJob`'s
 * reducer — the goal is to keep the session probe out of the JobPanel/ResultCard
 * surface entirely. The hook owns its own EventSource for the lifetime of one check.
 */
export function useSessionCheck(): UseSessionCheck {
  const [status, setStatus] = useState<SessionCheckStatus>("idle");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const logsRef = useRef<LogEntry[]>([]);
  const inFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      closeRef.current?.();
      closeRef.current = null;
    };
  }, []);

  const finish = useCallback((job: Job) => {
    const logs = logsRef.current;
    if (job.status === "success") {
      setStatus("verified");
      setCheckedAt(new Date());
      setClassifiedError(null);
      return;
    }
    if (job.status === "cancelled") {
      setStatus("idle");
      setClassifiedError(null);
      return;
    }
    const classified = classifyJobError(job.error, "check-session", logs);
    setCheckedAt(new Date());
    setClassifiedError(classified);
    setStatus(classified.isAuthIssue ? "unauth" : "error");
  }, []);

  const run = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus("checking");
    setClassifiedError(null);
    logsRef.current = [];
    closeRef.current?.();
    closeRef.current = null;

    let job: Job;
    try {
      job = await api.startJob({ command: "check-session" });
    } catch (err) {
      inFlightRef.current = false;
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus("error");
      setCheckedAt(new Date());
      setClassifiedError(classifyJobError(message, "check-session", []));
      return;
    }

    closeRef.current = subscribeToJob(job.id, {
      onLog: (entry) => {
        logsRef.current = [...logsRef.current, entry].slice(-50);
      },
      onError: (message) => {
        // SSE error event — usually transient. Defer to onDone to set the final state.
        logsRef.current = [
          ...logsRef.current,
          {
            id: `${Date.now()}-sse-error`,
            at: new Date().toISOString(),
            stream: "system",
            line: message,
          },
        ].slice(-50);
      },
      onDone: (finishedJob) => {
        inFlightRef.current = false;
        finish(finishedJob);
      },
      onConnectionLost: () => {
        inFlightRef.current = false;
        setStatus("error");
        setCheckedAt(new Date());
        setClassifiedError(
          classifyJobError(
            "Connection to local backend lost",
            "check-session",
            logsRef.current,
          ),
        );
      },
    });
  }, [finish]);

  const dismissError = useCallback(() => {
    setClassifiedError(null);
    if (status === "error") setStatus("idle");
  }, [status]);

  return {
    status,
    checkedAt,
    classifiedError,
    busy: status === "checking",
    run,
    dismissError,
  };
}
