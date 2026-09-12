export type Command =
  | "check-session"
  | "export-md"
  | "login"
  | "notion-dry-run"
  | "notion-publish";

export type JobStatus = "running" | "success" | "failed" | "cancelled";

export type PhaseKey =
  | "starting"
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
}

export interface ActiveJobsResponse {
  jobs: Job[];
  profile: { state: "available" | "external-browser" };
}

export interface ProfileBusyPayload {
  source: "application-job" | "external-browser";
  job?: Job;
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
