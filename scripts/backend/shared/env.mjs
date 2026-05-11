// Environment configuration for the SCORM → Notion app.
//
// The runtime only needs two real environment variables, both in `.env`:
//
//   NOTION_API_KEY        — integration token from notion.so/profile/integrations
//   BLACKBOARD_BASE_URL   — your institution's Blackboard, e.g.
//                           https://<your-institution>.blackboard.com/ultra/stream
//
// Everything else (course URL, SCORM title, Notion parent page, output path,
// etc.) is a per-job value entered in the web form. Those are forwarded to the
// child process as transient env overrides by `web/jobs.mjs`, so the helpers
// below read them as plain `process.env.X` lookups — there are no hardcoded
// fallbacks that could silently mask missing configuration.

/** Notion integration token. Required for `notion-dry-run` and `notion-publish`. */
export function configuredNotionApiKey() {
  return (process.env.NOTION_API_KEY || "").trim() || null;
}

/**
 * Base Blackboard URL for the institution. Required for `login` and
 * `check-session`. Used as the page the script navigates to when verifying
 * authentication; an authenticated session lands here directly, while an
 * expired one redirects to the Microsoft sign-in flow.
 */
export function configuredBlackboardBaseUrl() {
  return (process.env.BLACKBOARD_BASE_URL || "").trim() || null;
}

/** Fallback title used to search for the Notion parent page when no ID is given. */
export const DEFAULT_NOTION_PARENT_PAGE_TITLE = "Universidad";

// === Per-job overrides (set by web/jobs.mjs from the UI form) ===

export function configuredCourseOutlineUrl() {
  return (process.env.COURSE_OUTLINE_URL || "").trim();
}

export function isDirectScormUrl(value) {
  return /\/outline\/scorm\/overview\//.test(value || "");
}

export function configuredScormTitle() {
  return (process.env.SCORM_TITLE || "").trim();
}

/**
 * Pick the title used for the exported page. Order: explicit per-job override,
 * inferred from the SCORM page itself, then a generic fallback so we never
 * write a file with an empty name.
 */
export function resolveExportTitle(inferredTitle) {
  return configuredScormTitle() || (inferredTitle || "").trim() || "Untitled unit";
}

export function configuredNotionParentPageTitle() {
  return (
    (process.env.NOTION_PARENT_PAGE_TITLE || "").trim() ||
    DEFAULT_NOTION_PARENT_PAGE_TITLE
  );
}

/** Width ratio for embedded media in Notion. Clamped to a sane range. */
const DEFAULT_NOTION_MEDIA_WIDTH_RATIO = 0.85;
const NOTION_MEDIA_WIDTH_RATIO_MIN = 0.5;
const NOTION_MEDIA_WIDTH_RATIO_MAX = 1;

export function configuredNotionMediaWidthRatio() {
  const raw = process.env.NOTION_MEDIA_WIDTH_RATIO;
  if (raw === undefined || raw === "") return DEFAULT_NOTION_MEDIA_WIDTH_RATIO;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_NOTION_MEDIA_WIDTH_RATIO;
  return Math.min(
    NOTION_MEDIA_WIDTH_RATIO_MAX,
    Math.max(NOTION_MEDIA_WIDTH_RATIO_MIN, value),
  );
}
