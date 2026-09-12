import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, subscribeToJob } from "../lib/api";
import {
  clearSessionVerification,
  loadSessionVerification,
  saveSessionVerification,
} from "../lib/session-verification";
import type { Job, LogEntry, SessionSummary } from "../lib/types";
import { classifyJobError, type ClassifiedError } from "../lib/errors";

export type SessionCheckStatus =
  | "idle"
  | "checking"
  | "stored"
  | "verified"
  | "stale"
  | "unauth"
  | "error";

export type SessionCheckMode = "local" | "remote";

export interface UseSessionCheck {
  status: SessionCheckStatus;
  checkedAt: Date | null;
  classifiedError: ClassifiedError | null;
  busy: boolean;
  refreshing: boolean;
  interactive: boolean;
  bootstrapped: boolean;
  run: (mode?: SessionCheckMode, interactive?: boolean, background?: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  markVerified: () => void;
  markUnauthenticated: (error?: ClassifiedError) => void;
  dismissError: () => void;
}

const STORAGE_KEY = "scorm-notion:active-session-job";
const RECONNECT_PROBE_MS = 5000;

interface PersistedSessionJob {
  id: string;
  background: boolean;
}

function readPersistedJob(): PersistedSessionJob | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PersistedSessionJob>;
    return typeof parsed.id === "string" && parsed.id
      ? { id: parsed.id, background: parsed.background === true }
      : null;
  } catch {
    return null;
  }
}

function writePersistedJob(job: Job, background: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: job.id, background }));
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

function requiresLogin(session: SessionSummary): boolean {
  return session.destination === "login" || session.outcome === "login-required";
}

/**
 * Owns local, remote, and interactive session jobs. A successful remote result
 * is persisted only as non-secret visual continuity; every app launch still
 * performs a fresh remote check in the background.
 */
export function useSessionCheck(): UseSessionCheck {
  const snapshot = loadSessionVerification();
  const initialCheckedAt = snapshot ? new Date(snapshot.checkedAt) : null;
  const [status, setStatus] = useState<SessionCheckStatus>(snapshot ? "verified" : "idle");
  const [checkedAt, setCheckedAt] = useState<Date | null>(initialCheckedAt);
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const logsRef = useRef<LogEntry[]>([]);
  const inFlightRef = useRef(false);
  const backgroundRef = useRef(false);
  const lastVerifiedAtRef = useRef<Date | null>(initialCheckedAt);
  const reconnectTimerRef = useRef<number | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const restoreVerifiedSnapshot = useCallback((at = new Date()) => {
    const snapshot = saveSessionVerification(at);
    const checkedAt = new Date(snapshot.checkedAt);
    lastVerifiedAtRef.current = checkedAt;
    setStatus("verified");
    setCheckedAt(checkedAt);
    setClassifiedError(null);
  }, []);

  const invalidateVerifiedSnapshot = useCallback(() => {
    clearSessionVerification();
    lastVerifiedAtRef.current = null;
  }, []);

  const keepLastKnownState = useCallback(() => {
    if (lastVerifiedAtRef.current) {
      setStatus("stale");
      setCheckedAt(lastVerifiedAtRef.current);
    } else {
      setStatus("error");
    }
    setClassifiedError(null);
  }, []);

  const finish = useCallback(
    (job: Job) => {
      const background = backgroundRef.current;
      clearReconnectTimer();
      inFlightRef.current = false;
      jobIdRef.current = null;
      backgroundRef.current = false;
      setBusy(false);
      setRefreshing(false);
      setInteractive(false);
      clearPersistedJob();

      const session = job.summary?.session;
      if (session) {
        if (session.verified) {
          restoreVerifiedSnapshot();
          return;
        }
        if (session.mode === "local" && session.profileEvidence === "present") {
          setStatus("stored");
          setCheckedAt(new Date());
          setClassifiedError(null);
          return;
        }
        if (session.mode === "remote" && requiresLogin(session)) {
          invalidateVerifiedSnapshot();
          setStatus("unauth");
          setCheckedAt(new Date());
          setClassifiedError(null);
          return;
        }
        if (background) {
          keepLastKnownState();
          return;
        }

        setStatus("error");
        setCheckedAt(new Date());
        setClassifiedError(classifyJobError(job.error, "check-session", logsRef.current));
        return;
      }

      if (job.summary?.reachedBlackboard && job.status === "success") {
        restoreVerifiedSnapshot();
        return;
      }
      if (job.status === "cancelled") {
        setStatus(lastVerifiedAtRef.current ? "stale" : "idle");
        setCheckedAt(lastVerifiedAtRef.current);
        setClassifiedError(null);
        return;
      }
      if (background) {
        keepLastKnownState();
        return;
      }

      const classified = classifyJobError(job.error, "check-session", logsRef.current);
      setStatus(classified.isAuthIssue ? "unauth" : "error");
      setCheckedAt(new Date());
      setClassifiedError(classified);
    },
    [
      clearReconnectTimer,
      invalidateVerifiedSnapshot,
      keepLastKnownState,
      restoreVerifiedSnapshot,
    ],
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
    (job: Job, background = false): boolean => {
      if (!isSessionJob(job)) return false;
      if (job.status !== "running") {
        backgroundRef.current = background;
        finish(job);
        return true;
      }
      inFlightRef.current = true;
      backgroundRef.current = background;
      setBusy(true);
      setRefreshing(background);
      setStatus(background && lastVerifiedAtRef.current ? "verified" : "checking");
      setInteractive(job.interactive || job.command === "login");
      setClassifiedError(null);
      writePersistedJob(job, background);
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
          if (!cancelled && recover(job, persisted.background)) return;
        }

        const active = await api.activeJobs();
        const job = active.jobs.find(isSessionJob);
        if (!cancelled && job) recover(job);
        if (
          !cancelled &&
          !job &&
          (active.profile.state === "external-browser" || active.profile.state === "application-lock")
        ) {
          setCheckedAt(new Date());
          setStatus("error");
          setClassifiedError(
            classifyJobError(
              active.profile.state === "external-browser"
                ? "El perfil de Blackboard está abierto en otra ventana de navegador."
                : "El perfil de Blackboard está ocupado por otra tarea local.",
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
    async (mode: SessionCheckMode = "local", interactive = false, background = false) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      backgroundRef.current = background;
      setBusy(true);
      setRefreshing(background);
      setStatus(background && lastVerifiedAtRef.current ? "verified" : "checking");
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
        writePersistedJob(job, background);
        attach(job);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.busy?.source === "application-job" &&
          error.busy.job &&
          recover(error.busy.job, background)
        ) {
          return;
        }
        inFlightRef.current = false;
        backgroundRef.current = false;
        setBusy(false);
        setRefreshing(false);
        setInteractive(false);
        if (background) {
          keepLastKnownState();
          return;
        }
        setCheckedAt(new Date());
        const message = error instanceof Error ? error.message : "Unknown error";
        setStatus("error");
        setClassifiedError(classifyJobError(message, "check-session", []));
      }
    },
    [attach, clearReconnectTimer, keepLastKnownState, recover],
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
    if (status === "error") setStatus(lastVerifiedAtRef.current ? "stale" : "idle");
  }, [status]);

  const markVerified = useCallback(() => {
    clearReconnectTimer();
    inFlightRef.current = false;
    backgroundRef.current = false;
    setBusy(false);
    setRefreshing(false);
    setInteractive(false);
    restoreVerifiedSnapshot();
  }, [clearReconnectTimer, restoreVerifiedSnapshot]);

  const markUnauthenticated = useCallback((error?: ClassifiedError) => {
    invalidateVerifiedSnapshot();
    setStatus("unauth");
    setCheckedAt(new Date());
    setClassifiedError(error ?? null);
  }, [invalidateVerifiedSnapshot]);

  return {
    status,
    checkedAt,
    classifiedError,
    busy,
    refreshing,
    interactive,
    bootstrapped,
    run,
    cancel,
    markVerified,
    markUnauthenticated,
    dismissError,
  };
}
