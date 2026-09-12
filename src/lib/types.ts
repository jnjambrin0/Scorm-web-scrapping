export type Command =
  | "check-session"
  | "export-md"
  | "login"
  | "notion-dry-run"
  | "notion-publish";

export type JobStatus = "running" | "success" | "failed" | "cancelled";

export type PhaseKey =
  | "starting"
  | "blackboard-bootstrap"
  | "markdown"
  | "assets"
  | "notion-parent"
  | "upload"
  | "create-page"
  | "append-blocks"
  | "done";

export type EnvKey =
  | "COURSE_OUTLINE_URL"
  | "SCORM_TITLE"
  | "SCORM_MARKDOWN_OUT"
  | "NOTION_PARENT_PAGE_ID"
  | "NOTION_PARENT_PAGE_TITLE"
  | "NOTION_PAGE_TITLE"
  | "NOTION_MEDIA_WIDTH_RATIO"
  | "NOTION_PAID_PLAN";

export interface ConfigStatus {
  hasNotionApiKey: boolean;
  hasBlackboardBaseUrl: boolean;
  blackboardBaseUrl: string | null;
}

export interface Defaults {
  notionParentPageTitle: string;
  config: ConfigStatus;
}

export interface JobRequest {
  command: Command;
  envOverrides?: Partial<Record<EnvKey, string>>;
  flags?: {
    refresh?: boolean;
    deleteAfter?: boolean;
    remote?: boolean;
    interactive?: boolean;
  };
}

export interface SessionSummary {
  mode: "local" | "remote";
  interaction?: "none" | "manual";
  profileEvidence: "none" | "present";
  verified: boolean;
  destination: "not-checked" | "blackboard" | "login" | "unknown";
  outcome?: "verified" | "login-required" | "closed-before-verification" | "cancelled";
}

export interface JobSummary {
  mode?: "dry-run" | "publish" | string;
  title?: string;
  lessons?: number;
  blocks?: number;
  mediaReferences?: number;
  uniqueAssets?: number;
  images?: number;
  videos?: number;
  downloadedAssets?: number;
  failedAssets?: number;
  uploadedAssets?: number;
  reusedUploads?: number;
  failedUploads?: number;
  totalAssetBytes?: number;
  uploadChunks?: number;
  notionParentPageTitle?: string;
  notionParentPageId?: string;
  notionPageUrl?: string;
  deletedAfterValidation?: boolean;
  kind?: "session-check" | string;
  session?: SessionSummary;
  reachedBlackboard?: boolean;
  destination?: string;
}

export interface Job {
  id: string;
  command: Command;
  status: JobStatus;
  currentPhase: PhaseKey | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  summary: JobSummary | null;
  finalUrl: string | null;
  error: string | null;
  interactive?: boolean;
  remote?: boolean;
  errorCode?: string | null;
  queueBatchId?: string | null;
  queueItemId?: string | null;
}

export interface QueueConfig {
  url: string;
  title: string;
  parentTitle: string;
  parentId: string;
  scormTitle: string;
  refresh: boolean;
  paidPlan: boolean;
  mediaWidthRatio: number;
}
export type QueueItemStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "incomplete" | "interrupted" | "blocked";
export interface QueueAttempt {
  id: string;
  jobId: string;
  status: QueueItemStatus;
  startedAt: string;
  finishedAt: string | null;
  publicationStage: string;
  notionPageUrl?: string | null;
  title?: string;
  error?: string;
  errorCode?: string | null;
  summary?: JobSummary;
}
export interface QueueItem {
  id: string;
  config: QueueConfig;
  status: QueueItemStatus;
  attempts: QueueAttempt[];
  job: Job | null;
}
export interface QueueBatch {
  id: string;
  createdAt: string;
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  reason: string | null;
  items: QueueItem[];
}
export interface QueueSnapshot {
  revision: number;
  storageError: string | null;
  batches: QueueBatch[];
}
export interface QueueMutation {
  action: "create" | "add" | "edit" | "remove" | "reorder" | "start" | "resume" | "pause" | "cancel-current" | "stop" | "retry";
  batchId?: string;
  itemId?: string;
  config?: QueueConfig;
  order?: string[];
  confirmNewPage?: boolean;
}

export interface ActiveJobsResponse {
  jobs: Job[];
  profile: {
    state: "available" | "external-browser" | "application-lock" | "stale-lock";
    owner?: ProfileLockOwner | null;
  };
}

export interface ProfileLockOwner {
  pid: number;
  createdAt: string | null;
  command: string | null;
  jobId: string | null;
}

export interface ProfileBusyPayload {
  source: "application-job" | "external-browser" | "application-lock";
  job?: Job;
  owner?: ProfileLockOwner | null;
}

export interface PhaseProgress {
  kind: "assets" | "upload-parts" | "block-batches" | string;
  current: number;
  total: number;
}

export interface PhaseEvent {
  at: string;
  phase: PhaseKey;
  message: string;
  progress: PhaseProgress | null;
}

export type LogStream = "stdout" | "stderr" | "system";

export interface LogEntry {
  id: string;
  at: string;
  stream: LogStream | string;
  line: string;
}

export interface SummaryEvent {
  at: string;
  summary: JobSummary;
  finalUrl: string | null;
}
