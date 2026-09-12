import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, subscribeToJob } from "../lib/api";
import type { Job, LogEntry } from "../lib/types";
import { classifyJobError, type ClassifiedError } from "../lib/errors";

export type SessionCheckStatus =
  | "idle"
  | "checking"
  | "stored"
  | "verified"
  | "unauth"
  | "error";

export type SessionCheckMode = "local" | "remote";

export interface UseSessionCheck {
  status: SessionCheckStatus;
  checkedAt: Date | null;
  classifiedError: ClassifiedError | null;
  busy: boolean;
  interactive: boolean;
  bootstrapped: boolean;
  run: (mode?: SessionCheckMode, interactive?: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  markVerified: () => void;
  markUnauthenticated: (error?: ClassifiedError) => void;
  dismissError: () => void;
}

const STORAGE_KEY = "scorm-notion:active-session-job";
const RECONNECT_PROBE_MS = 5000;

interface PersistedSessionJob {
  id: string;
}

function readPersistedJob(): PersistedSessionJob | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as PersistedSessionJob;
    return parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function writePersistedJob(job: Job) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: job.id }));
  } catch {
    // Recovery is optional when sessionStorage is unavailable.
  }
}

function clearPersistedJob() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Recovery is optional when sessionStorage is unavailable.
  }
}

function isSessionJob(job: Job): boolean {
  return job.command === "check-session" || job.command === "login";
}

/**
 * Owns every session-related child process, including recovery after a page
 * reload. Unlike export jobs, an interactive login has no user-entry timeout.
 */
export function useSessionCheck(): UseSessionCheck {
  const [status, setStatus] = useState<SessionCheckStatus>("idle");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(null);
  const [interactive, setInteractive] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const logsRef = useRef<LogEntry[]>([]);
  const inFlightRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (job: Job) => {
      clearReconnectTimer();
      inFlightRef.current = false;
      jobIdRef.current = null;
      setInteractive(false);
      clearPersistedJob();

      const session = job.summary?.session;
      setCheckedAt(new Date());
      if (session) {
        if (session.verified) {
          setStatus("verified");
          setClassifiedError(null);
          return;
        }
        if (session.mode === "local" && session.profileEvidence === "present") {
          setStatus("stored");
          setClassifiedError(null);
          return;
        }

        const classified =
          job.status === "failed"
            ? classifyJobError(job.error, "check-session", logsRef.current)
            : null;
        setStatus("unauth");
        setClassifiedError(classified);
        return;
      }

      if (job.summary?.reachedBlackboard && job.status === "success") {
        setStatus("verified");
        setClassifiedError(null);
        return;
      }
      if (job.status === "cancelled") {
        setStatus("idle");
        setClassifiedError(null);
        return;
      }

      const classified = classifyJobError(job.error, "check-session", logsRef.current);
      setStatus(classified.isAuthIssue ? "unauth" : "error");
      setClassifiedError(classified);
    },
    [clearReconnectTimer],
  );

  const scheduleReconnectProbe = useCallback(() => {
    const id = jobIdRef.current;
    if (!id || reconnectTimerRef.current !== null) return;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void api
        .getJob(id)
        .then((job) => {
          if (job.status !== "running") finish(job);
        })
        .catch(() => {
          // EventSource keeps reconnecting; preserve the active state until the
          // backend can authoritatively report that the job is gone.
        });
    }, RECONNECT_PROBE_MS);
  }, [finish]);

  const attach = useCallback(
    (job: Job) => {
      closeRef.current?.();
      jobIdRef.current = job.id;
      closeRef.current = subscribeToJob(job.id, {
        onLog: (entry) => {
          logsRef.current = [...logsRef.current, entry].slice(-50);
        },
        onDone: finish,
        onReconnecting: scheduleReconnectProbe,
        onConnectionLost: scheduleReconnectProbe,
      });
    },
    [finish, scheduleReconnectProbe],
  );

  const recover = useCallback(
    (job: Job): boolean => {
      if (!isSessionJob(job)) return false;
      if (job.status !== "running") {
        finish(job);
        return true;
      }
      inFlightRef.current = true;
      setStatus("checking");
      setInteractive(job.interactive || job.command === "login");
      setClassifiedError(null);
      writePersistedJob(job);
      attach(job);
      return true;
    },
    [attach, finish],
  );

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const persisted = readPersistedJob();
        if (persisted) {
          const job = await api.getJob(persisted.id);
          if (!cancelled && recover(job)) return;
        }

        const active = await api.activeJobs();
        const job = active.jobs.find(isSessionJob);
        if (!cancelled && job) recover(job);
        if (!cancelled && !job && active.profile.state === "external-browser") {
          setCheckedAt(new Date());
          setStatus("error");
          setClassifiedError(
            classifyJobError(
              "El perfil de Blackboard está abierto en otra ventana de navegador.",
              "check-session",
              [],
            ),
          );
        }
      } catch {
        clearPersistedJob();
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [recover]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      closeRef.current?.();
      closeRef.current = null;
    };
  }, [clearReconnectTimer]);

  const run = useCallback(
    async (mode: SessionCheckMode = "local", interactive = false) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStatus("checking");
      setInteractive(mode === "remote" && interactive);
      setClassifiedError(null);
      logsRef.current = [];
      clearReconnectTimer();
      closeRef.current?.();
      closeRef.current = null;

      try {
        const job = await api.startJob({
          command: "check-session",
          flags: {
            remote: mode === "remote",
            interactive: mode === "remote" && interactive,
          },
        });
        writePersistedJob(job);
        attach(job);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.busy?.source === "application-job" &&
          error.busy.job &&
          recover(error.busy.job)
        ) {
          return;
        }
        inFlightRef.current = false;
        setInteractive(false);
        setCheckedAt(new Date());
        const message = error instanceof Error ? error.message : "Unknown error";
        setStatus("error");
        setClassifiedError(classifyJobError(message, "check-session", []));
      }
    },
    [attach, clearReconnectTimer, recover],
  );

  const cancel = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      await api.cancelJob(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cancelar el inicio de sesión.";
      setClassifiedError(classifyJobError(message, "check-session", logsRef.current));
    }
  }, []);

  const dismissError = useCallback(() => {
    setClassifiedError(null);
    if (status === "error") setStatus("idle");
  }, [status]);

  const markVerified = useCallback(() => {
    clearReconnectTimer();
    inFlightRef.current = false;
    setInteractive(false);
    setStatus("verified");
    setCheckedAt(new Date());
    setClassifiedError(null);
  }, [clearReconnectTimer]);

  const markUnauthenticated = useCallback((error?: ClassifiedError) => {
    setStatus("unauth");
    setCheckedAt(new Date());
    setClassifiedError(error ?? null);
  }, []);

  return {
    status,
    checkedAt,
    classifiedError,
    busy: status === "checking",
    interactive,
    bootstrapped,
    run,
    cancel,
    markVerified,
    markUnauthenticated,
    dismissError,
  };
}
