import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeToJob } from "../lib/api";
import type { Job } from "../lib/types";

export interface UseLoginOptions {
  /** Called when the login process ends, whether authentication succeeded or not. */
  onCompleted?: (job: Job) => void;
}

export interface UseLogin {
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  dismissError: () => void;
}

/**
 * Spawns the `login` backend command (opens a real Chromium window for the user
 * to sign into Blackboard). The hook only reports busy/idle to the UI — the
 * heavy lifting happens in the browser window. When the window closes, the
 * `onCompleted` callback fires so callers can trigger a fresh session check.
 *
 * Like `useSessionCheck`, this does not write to sessionStorage and does not
 * dispatch to `useJob`'s reducer.
 */
export function useLogin({ onCompleted }: UseLoginOptions = {}): UseLogin {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    return () => {
      closeRef.current?.();
      closeRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    closeRef.current?.();
    closeRef.current = null;

    let job: Job;
    try {
      job = await api.startJob({ command: "login" });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not start Blackboard login.");
      return;
    }

    jobIdRef.current = job.id;
    closeRef.current = subscribeToJob(job.id, {
      onDone: (finishedJob) => {
        setBusy(false);
        jobIdRef.current = null;
        if (finishedJob.status === "failed") {
          setError(finishedJob.error || "Login browser closed before authentication completed.");
        }
        onCompletedRef.current?.(finishedJob);
      },
      onConnectionLost: () => {
        setBusy(false);
        jobIdRef.current = null;
        setError("Connection to local backend lost during Blackboard login.");
      },
    });
  }, [busy]);

  const cancel = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      await api.cancelJob(id);
    } finally {
      setBusy(false);
      jobIdRef.current = null;
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { busy, error, start, cancel, dismissError };
}
