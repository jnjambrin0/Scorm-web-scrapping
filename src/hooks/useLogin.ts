import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeToJob } from "../lib/api";
import type { Job } from "../lib/types";

export interface UseLoginOptions {
  /** Called when the login window closes successfully (regardless of auth outcome). */
  onCompleted?: () => void;
}

export interface UseLogin {
  busy: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
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
    closeRef.current?.();
    closeRef.current = null;

    let job: Job;
    try {
      job = await api.startJob({ command: "login" });
    } catch {
      setBusy(false);
      return;
    }

    jobIdRef.current = job.id;
    closeRef.current = subscribeToJob(job.id, {
      onDone: () => {
        setBusy(false);
        jobIdRef.current = null;
        onCompletedRef.current?.();
      },
      onConnectionLost: () => {
        setBusy(false);
        jobIdRef.current = null;
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

  return { busy, start, cancel };
}
