const KEY = "scorm-notion:queue-resume";
export interface QueueResumeIntent { batchId: string; requestedAt: number }

export function readQueueResume(): QueueResumeIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!value || typeof value.batchId !== "string" || !/^[a-f0-9-]{36}$/.test(value.batchId) || !Number.isFinite(value.requestedAt)) return null;
    return { batchId: value.batchId, requestedAt: value.requestedAt };
  } catch { return null; }
}

export function saveQueueResume(value: QueueResumeIntent | null) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch { /* The current tab can still complete the operation without storage. */ }
}
