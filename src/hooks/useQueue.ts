import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { QueueMutation, QueueSnapshot } from "../lib/types";

export function useQueue() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<QueueSnapshot | null>(null);
  const mutation = useRef(false);
  const accept = useCallback((next: QueueSnapshot) => {
    if (current.current && next.revision < current.current.revision) return;
    current.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    const source = new EventSource("/api/queues/events");
    const refresh = () => api.queues().then((next) => {
      if (disposed) return;
      accept(next); setBootstrapped(true);
    }).catch(() => { if (!disposed) setError("connection"); });
    source.addEventListener("snapshot", (event) => {
      if (disposed) return;
      accept(JSON.parse((event as MessageEvent<string>).data));
      setBootstrapped(true); setConnected(true);
      setError((previous) => previous === "connection" ? null : previous);
    });
    source.onopen = () => { setConnected(true); void refresh(); };
    source.onerror = () => { setConnected(false); };
    void refresh();
    const timer = window.setInterval(() => { if (source.readyState !== EventSource.OPEN) void refresh(); }, 5000);
    return () => { disposed = true; source.close(); window.clearInterval(timer); };
  }, [accept]);

  const mutate = useCallback(async (request: QueueMutation) => {
    if (mutation.current || !current.current || !connected) return false;
    mutation.current = true; setBusy(true); setError(null);
    const payload = { ...request, revision: current.current.revision, operationId: crypto.randomUUID() };
    try {
      // Retry only an uncertain transport failure, with the same operation ID.
      let result;
      try { result = await api.mutateQueue(payload); } catch (error) {
        if (error instanceof ApiError) throw error;
        result = await api.mutateQueue(payload);
      }
      accept(result);
      return true;
    } catch (error) {
      setError(error instanceof ApiError ? error.code || "request" : "connection");
      await api.queues().then(accept).catch(() => {});
      return false;
    } finally { mutation.current = false; setBusy(false); }
  }, [accept, connected]);

  const activeBatch = snapshot?.batches.find((b) => !["completed", "stopped"].includes(b.status));
  const running = !!snapshot?.batches.some((b) => b.status === "running" || b.items.some((i) => i.status === "running"));
  return { snapshot, activeBatch, running, busy, connected, bootstrapped, error, mutate };
}
