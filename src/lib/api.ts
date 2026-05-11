import type {
  Defaults,
  Job,
  JobRequest,
  LogEntry,
  PhaseEvent,
  SummaryEvent,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as { error?: string } | null;
    throw new ApiError(
      payload?.error || `La petición ha fallado (${response.status}).`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  defaults: () => request<Defaults>("/config/defaults"),
  startJob: (req: JobRequest) =>
    request<Job>("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  cancelJob: (id: string) =>
    request<{ cancelled: boolean; job: Job }>(`/jobs/${id}/cancel`, {
      method: "POST",
    }),
};

export interface SseHandlers {
  onPhase?: (event: PhaseEvent) => void;
  onLog?: (entry: LogEntry) => void;
  onSummary?: (event: SummaryEvent) => void;
  onError?: (message: string) => void;
  onDone?: (job: Job) => void;
  onConnectionLost?: () => void;
}

function parseEventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

export function subscribeToJob(jobId: string, handlers: SseHandlers): () => void {
  const source = new EventSource(`${BASE}/jobs/${jobId}/events`);

  source.addEventListener("phase", (event) => {
    handlers.onPhase?.(parseEventData<PhaseEvent>(event));
  });

  source.addEventListener("log", (event) => {
    const payload = parseEventData<LogEntry>(event);
    handlers.onLog?.({
      ...payload,
      id: event.lastEventId || `${Date.now()}-${Math.random()}`,
    });
  });

  source.addEventListener("summary", (event) => {
    handlers.onSummary?.(parseEventData<SummaryEvent>(event));
  });

  source.addEventListener("error", (event) => {
    if ("data" in event && typeof (event as MessageEvent<string>).data === "string") {
      const payload = parseEventData<{ message: string }>(event);
      handlers.onError?.(payload.message);
    }
  });

  source.addEventListener("done", (event) => {
    const payload = parseEventData<{ job: Job }>(event);
    handlers.onDone?.(payload.job);
    source.close();
  });

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      return;
    }
    handlers.onConnectionLost?.();
  };

  return () => source.close();
}
