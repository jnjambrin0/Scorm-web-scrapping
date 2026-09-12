import type {
  ActiveJobsResponse,
  Defaults,
  Job,
  JobRequest,
  LogEntry,
  PhaseEvent,
  ProfileBusyPayload,
  SummaryEvent,
  QueueSnapshot,
  QueueMutation,
} from "./types";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  busy: ProfileBusyPayload | null;
  code: string | null;
  constructor(message: string, status: number, busy: ProfileBusyPayload | null = null, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.busy = busy;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as { error?: string; busy?: ProfileBusyPayload; code?: string } | null;
    throw new ApiError(
      payload?.error || `La petición ha fallado (${response.status}).`,
      response.status,
      payload?.busy || null,
      payload?.code || null,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  queues: () => request<QueueSnapshot>("/queues"),
  mutateQueue: (req: QueueMutation & { revision: number; operationId: string }) => request<QueueSnapshot>("/queues", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  }),
  defaults: () => request<Defaults>("/config/defaults"),
  startJob: (req: JobRequest) =>
    request<Job>("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    }),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  activeJobs: () => request<ActiveJobsResponse>("/jobs/active"),
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
  onReconnecting?: () => void;
  onConnectionLost?: () => void;
}

function parseEventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

export function subscribeToJob(jobId: string, handlers: SseHandlers): () => void {
  const source = new EventSource(`${BASE}/jobs/${jobId}/events`);
  let finished = false;

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
    if (finished) return;
    finished = true;
    const payload = parseEventData<{ job: Job }>(event);
    handlers.onDone?.(payload.job);
    source.close();
  });

  source.onerror = () => {
    if (finished) return;
    if (source.readyState === EventSource.CLOSED) {
      return;
    }
    handlers.onReconnecting?.();
  };

  return () => source.close();
}
