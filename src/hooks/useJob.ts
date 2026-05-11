import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, subscribeToJob } from "../lib/api";
import type {
  Command,
  Job,
  JobRequest,
  JobSummary,
  LogEntry,
  PhaseEvent,
} from "../lib/types";

export type UiStatus = "idle" | "running" | "success" | "failed" | "cancelled";

interface State {
  job: Job | null;
  status: UiStatus;
  phase: PhaseEvent | null;
  logs: LogEntry[];
  summary: JobSummary | null;
  finalUrl: string | null;
  error: string | null;
  command: Command | null;
}

const initialState: State = {
  job: null,
  status: "idle",
  phase: null,
  logs: [],
  summary: null,
  finalUrl: null,
  error: null,
  command: null,
};

const MAX_LOGS = 400;
const STORAGE_KEY = "scorm-notion:active-job";
const RECOVERY_TTL_MS = 10 * 60 * 1000;

interface PersistedJob {
  id: string;
  command: Command;
  startedAt: string;
}

function readPersistedJob(): PersistedJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedJob;
    if (!parsed.id || !parsed.command || !parsed.startedAt) return null;
    const age = Date.now() - new Date(parsed.startedAt).getTime();
    if (Number.isNaN(age) || age < 0 || age > RECOVERY_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedJob(job: Job) {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedJob = {
      id: job.id,
      command: job.command,
      startedAt: job.startedAt,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage unavailable — degrade gracefully */
  }
}

function clearPersistedJob() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable — degrade gracefully */
  }
}

type Action =
  | { type: "reset" }
  | { type: "started"; job: Job }
  | { type: "phase"; event: PhaseEvent }
  | { type: "log"; entry: LogEntry }
  | { type: "summary"; summary: JobSummary; finalUrl: string | null }
  | { type: "error"; message: string }
  | { type: "done"; job: Job }
  | { type: "rehydrate"; job: Job };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return initialState;
    case "started":
      return {
        ...initialState,
        job: action.job,
        status: "running",
        command: action.job.command,
      };
    case "phase":
      return { ...state, phase: action.event };
    case "log": {
      const next =
        state.logs.length >= MAX_LOGS
          ? state.logs.slice(state.logs.length - MAX_LOGS + 1)
          : state.logs;
      return { ...state, logs: [...next, action.entry] };
    }
    case "summary":
      return {
        ...state,
        summary: action.summary,
        finalUrl: action.finalUrl ?? state.finalUrl,
      };
    case "error":
      return { ...state, error: action.message };
    case "done":
      return {
        ...state,
        job: action.job,
        status: action.job.status,
        command: action.job.command,
        summary: action.job.summary ?? state.summary,
        finalUrl: action.job.finalUrl ?? state.finalUrl,
        error: action.job.error ?? state.error,
      };
    case "rehydrate":
      return {
        ...initialState,
        job: action.job,
        command: action.job.command,
        status: action.job.status === "running" ? "running" : action.job.status,
        summary: action.job.summary,
        finalUrl: action.job.finalUrl,
        error: action.job.error,
        phase: action.job.currentPhase
          ? {
              at: action.job.startedAt,
              phase: action.job.currentPhase,
              message: "",
              progress: null,
            }
          : null,
      };
    default:
      return state;
  }
}

export function useJob() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [bootstrapped, setBootstrapped] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const rehydrateAttemptedRef = useRef(false);

  function subscribe(jobId: string) {
    closeRef.current?.();
    closeRef.current = subscribeToJob(jobId, {
      onPhase: (event) => dispatch({ type: "phase", event }),
      onLog: (entry) => dispatch({ type: "log", entry }),
      onSummary: ({ summary, finalUrl }) =>
        dispatch({ type: "summary", summary, finalUrl }),
      onError: (message) => dispatch({ type: "error", message }),
      onDone: (job) => {
        clearPersistedJob();
        dispatch({ type: "done", job });
      },
      onConnectionLost: () =>
        dispatch({
          type: "error",
          message: "Se ha perdido la conexión con el backend local.",
        }),
    });
  }

  // Recover an in-flight or just-finished job after page reload.
  useEffect(() => {
    if (rehydrateAttemptedRef.current) return;
    rehydrateAttemptedRef.current = true;

    const persisted = readPersistedJob();
    if (!persisted) {
      setBootstrapped(true);
      return;
    }

    let cancelled = false;
    api
      .getJob(persisted.id)
      .then((job) => {
        if (cancelled) return;
        dispatch({ type: "rehydrate", job });
        if (job.status === "running") {
          subscribe(job.id);
        } else {
          clearPersistedJob();
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearPersistedJob();
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      closeRef.current?.();
      closeRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    clearPersistedJob();
    dispatch({ type: "reset" });
  }, []);

  const start = useCallback(async (request: JobRequest) => {
    closeRef.current?.();
    closeRef.current = null;
    dispatch({ type: "reset" });

    let job: Job;
    try {
      job = await api.startJob(request);
    } catch (err) {
      dispatch({
        type: "error",
        message:
          err instanceof Error ? err.message : "Error desconocido al iniciar el trabajo.",
      });
      return;
    }

    writePersistedJob(job);
    dispatch({ type: "started", job });
    subscribe(job.id);
  }, []);

  const cancel = useCallback(async () => {
    if (!state.job || state.status !== "running") {
      return;
    }
    try {
      await api.cancelJob(state.job.id);
    } catch (err) {
      dispatch({
        type: "error",
        message:
          err instanceof Error ? err.message : "No se pudo cancelar el trabajo.",
      });
    }
  }, [state.job, state.status]);

  return {
    job: state.job,
    status: state.status,
    command: state.command,
    phase: state.phase,
    logs: state.logs,
    summary: state.summary,
    finalUrl: state.finalUrl,
    error: state.error,
    bootstrapped,
    start,
    cancel,
    reset,
  };
}
