// User-facing preferences persisted in localStorage. These are the values that
// pre-populate the publish form and tune the Notion export. They live on the
// browser side only — nothing here is forwarded to the backend automatically,
// except the media width ratio which `App.tsx` sends as an `envOverride`
// when a Notion job starts.

export interface Settings {
  formDefaults: {
    notionParentPageTitle: string;
    notionParentPageId: string;
    refresh: boolean;
    deleteAfter: boolean;
  };
  notion: {
    /** Width applied to embedded images/videos in Notion. Clamp 0.5 — 1.0. */
    mediaWidthRatio: number;
    /**
     * `true` ⇒ user declares the workspace is on a paid plan (Plus / Business
     * / Education / Enterprise) and the 5 MiB Free-tier cap doesn't apply.
     * `false` (default) ⇒ filter out anything over 5 MiB before uploading.
     */
    paidPlan: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  formDefaults: {
    notionParentPageTitle: "Universidad",
    notionParentPageId: "",
    refresh: false,
    deleteAfter: false,
  },
  notion: {
    mediaWidthRatio: 0.85,
    // Default `true` because the canonical user — a university student —
    // typically has Notion Education (free, paid-tier limits). If they're
    // actually on Free we surface the `file_upload_invalid_size` error with
    // a clear 3-option hint so they can turn this off in one click.
    paidPlan: true,
  },
};

export const SETTINGS_STORAGE_KEY = "scorm-notion:settings";

export const MEDIA_WIDTH_RATIO_MIN = 0.5;
export const MEDIA_WIDTH_RATIO_MAX = 1;
export const MEDIA_WIDTH_RATIO_STEP = 0.05;

function clampMediaWidthRatio(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.notion.mediaWidthRatio;
  return Math.min(MEDIA_WIDTH_RATIO_MAX, Math.max(MEDIA_WIDTH_RATIO_MIN, n));
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Read settings from localStorage. Tolerates missing keys, corrupted JSON, and
 * future schema migrations by deep-merging anything we recognise against
 * `DEFAULT_SETTINGS`. Anything unknown is dropped silently.
 */
export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!raw) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS;
  const candidate = parsed as Partial<Settings>;
  const formDefaultsRaw = candidate.formDefaults ?? {};
  const notionRaw = candidate.notion ?? {};
  return {
    formDefaults: {
      notionParentPageTitle: pickString(
        (formDefaultsRaw as Settings["formDefaults"]).notionParentPageTitle,
        DEFAULT_SETTINGS.formDefaults.notionParentPageTitle,
      ),
      notionParentPageId: pickString(
        (formDefaultsRaw as Settings["formDefaults"]).notionParentPageId,
        DEFAULT_SETTINGS.formDefaults.notionParentPageId,
      ),
      refresh: pickBoolean(
        (formDefaultsRaw as Settings["formDefaults"]).refresh,
        DEFAULT_SETTINGS.formDefaults.refresh,
      ),
      deleteAfter: pickBoolean(
        (formDefaultsRaw as Settings["formDefaults"]).deleteAfter,
        DEFAULT_SETTINGS.formDefaults.deleteAfter,
      ),
    },
    notion: {
      mediaWidthRatio: clampMediaWidthRatio(
        (notionRaw as Settings["notion"]).mediaWidthRatio,
      ),
      paidPlan: pickBoolean(
        (notionRaw as Settings["notion"]).paidPlan,
        DEFAULT_SETTINGS.notion.paidPlan,
      ),
    },
  };
}

export function saveSettings(value: Settings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* localStorage unavailable / quota exceeded — degrade silently. */
  }
}

/** Normalise an incoming partial update — used by the hook to enforce bounds. */
export function sanitizeSettings(value: Settings): Settings {
  return {
    formDefaults: {
      notionParentPageTitle: value.formDefaults.notionParentPageTitle.trim() === ""
        ? DEFAULT_SETTINGS.formDefaults.notionParentPageTitle
        : value.formDefaults.notionParentPageTitle,
      notionParentPageId: value.formDefaults.notionParentPageId,
      refresh: value.formDefaults.refresh,
      deleteAfter: value.formDefaults.deleteAfter,
    },
    notion: {
      mediaWidthRatio: clampMediaWidthRatio(value.notion.mediaWidthRatio),
      paidPlan: value.notion.paidPlan,
    },
  };
}
