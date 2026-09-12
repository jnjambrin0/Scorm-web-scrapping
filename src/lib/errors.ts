import type { Command, LogEntry } from "./types";
import type { StringKey } from "./i18n";

export interface ClassifiedError {
  titleKey: StringKey;
  hintKey: StringKey;
  /** Raw error + recent log tail, ready for a collapsible technical-details view. */
  technicalDetails: string | null;
  /**
   * Whether this error indicates the Blackboard session is no longer valid.
   * Callers can use this to nudge users into the login flow instead of a generic retry.
   */
  isAuthIssue: boolean;
}

interface Pattern {
  test: (raw: string, log: string) => boolean;
  titleKey: StringKey;
  hintKey: StringKey;
  isAuthIssue?: boolean;
}

const NODE_BANNER = /^Node\.js v[\d.]+$/m;
const PLAYWRIGHT_MISSING = /(Executable doesn't exist|Browser was not found|playwright[\\/]\.cache|missing dependencies to run browsers)/i;
const SESSION_EXPIRED_LOG = /(Authenticated:\s*no|login\.microsoftonline\.com|\bsign[\s-]in\b)/i;
// Chromium DNS / connectivity failures — happens when the configured URL host
// doesn't resolve (placeholder URLs, typos) or the network blocks the request.
const URL_UNREACHABLE = /\bnet::ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|TUNNEL_CONNECTION_FAILED)\b/;
const BLACKBOARD_TIMEOUT = /(Timeout\s+\d+ms\s+exceeded|TimeoutError\b|page\.goto|navigating to "https?:[^"]+",\s*waiting until|waiting for navigation)/i;
const NOTION_API = /(notion[^.]*api|HTTP\s+(?:401|403|404|409|429|5\d\d).*notion|\bunauthorized\b|\bforbidden\b|object_not_found)/i;
// Specific Notion error fired when an uploaded file exceeds the workspace's
// per-file size limit (5 MiB on Free; 5 GiB on Plus / Business / Education /
// Enterprise). Surfaced as a distinct category so we can hint the user
// towards the paid-plan switch instead of the generic "API rejected" message.
const NOTION_FILE_SIZE = /(file_upload_invalid_size|file size is not within the allowed limit of \d+\s*(MiB|GiB|MB|GB))/i;
const FILESYSTEM = /\b(ENOENT|EACCES|EPERM|ENOTDIR|EISDIR)\b/;
const NETWORK = /\b(ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|getaddrinfo|fetch failed|Failed to fetch|NetworkError)\b/i;
const PROFILE_BUSY = /(BROWSER_PROFILE_BUSY|Browser profile is already in use|perfil de Blackboard (?:está en uso|está abierto|está ocupado)|perfil.*en uso|tarea de Blackboard aún activa)/i;
const LOGIN_INCOMPLETE = /Login window closed before reaching Blackboard|Interactive Blackboard verification was closed|inicio de sesión.*no ha terminado|closed before reaching Blackboard/i;
const SCORM_SOURCE_HTTP = /Direct SCORM source returned HTTP \d+/i;
const SCORM_LINK_MISSING = /Direct SCORM source did not render a matching SCORM link/i;
const SCORM_LINK_AMBIGUOUS = /Direct SCORM source rendered multiple matching SCORM links/i;
const SCORM_LINK_WRONG = /Direct SCORM resolved link did not open the expected item/i;
const SCORM_PLAYER = /SCORM attempt (?:reached Blackboard launch frame but did not open a supported player|did not create or navigate to a supported player page|opened multiple eligible player pages)|SCORM player was opened but its content surface did not become ready/i;
const SCORM_ITEM = /Could not find SCORM item|Could not find course link/i;
const SCORM_URL = /SCORM URL did not resolve|Direct SCORM URL did not resolve as entered|Could not find Start\/Continue attempt control|staged cache was not promoted/i;
const CACHE_INVALID = /Cache status: (?:manifest-missing|manifest-invalid|markdown-missing|source-mismatch|source-schema-migration)/i;
const PROCESS_CRASH = /Job failed with code/;

const PATTERNS: ReadonlyArray<Pattern> = [
  {
    test: (raw) => /SESSION_INVALID/.test(raw),
    titleKey: "error.session.expired",
    hintKey: "error.session.expired.hint",
    isAuthIssue: true,
  },
  {
    test: (raw) => /Cannot publish: \d+ assets failed to download|SCORM asset download stopped|SCORM asset could not be saved locally/.test(raw),
    titleKey: "error.assets.download",
    hintKey: "error.assets.download.hint",
  },
  {
    test: (raw, log) => PROFILE_BUSY.test(raw) || PROFILE_BUSY.test(log),
    titleKey: "error.profile.busy",
    hintKey: "error.profile.busy.hint",
  },
  {
    test: (raw, log) => LOGIN_INCOMPLETE.test(raw) || LOGIN_INCOMPLETE.test(log),
    titleKey: "error.login.incomplete",
    hintKey: "error.login.incomplete.hint",
  },
  {
    test: (raw, log) => SCORM_SOURCE_HTTP.test(raw) || SCORM_SOURCE_HTTP.test(log),
    titleKey: "error.scorm.sourceHttp",
    hintKey: "error.scorm.sourceHttp.hint",
  },
  {
    test: (raw, log) => SCORM_LINK_MISSING.test(raw) || SCORM_LINK_MISSING.test(log),
    titleKey: "error.scorm.linkMissing",
    hintKey: "error.scorm.linkMissing.hint",
  },
  {
    test: (raw, log) => SCORM_LINK_AMBIGUOUS.test(raw) || SCORM_LINK_AMBIGUOUS.test(log),
    titleKey: "error.scorm.linkAmbiguous",
    hintKey: "error.scorm.linkAmbiguous.hint",
  },
  {
    test: (raw, log) => SCORM_LINK_WRONG.test(raw) || SCORM_LINK_WRONG.test(log),
    titleKey: "error.scorm.linkWrong",
    hintKey: "error.scorm.linkWrong.hint",
  },
  {
    test: (raw, log) => SCORM_PLAYER.test(raw) || SCORM_PLAYER.test(log),
    titleKey: "error.scorm.player",
    hintKey: "error.scorm.player.hint",
  },
  {
    test: (raw, _log) => PLAYWRIGHT_MISSING.test(raw),
    titleKey: "error.playwright.missing",
    hintKey: "error.playwright.missing.hint",
  },
  {
    test: (raw, log) => SESSION_EXPIRED_LOG.test(raw) || SESSION_EXPIRED_LOG.test(log),
    titleKey: "error.session.expired",
    hintKey: "error.session.expired.hint",
    isAuthIssue: true,
  },
  {
    test: (raw, log) => URL_UNREACHABLE.test(raw) || URL_UNREACHABLE.test(log),
    titleKey: "error.url.unreachable",
    hintKey: "error.url.unreachable.hint",
  },
  {
    test: (raw, log) => BLACKBOARD_TIMEOUT.test(raw) || BLACKBOARD_TIMEOUT.test(log),
    titleKey: "error.blackboard.unreachable",
    hintKey: "error.blackboard.unreachable.hint",
  },
  {
    test: (raw, log) => NOTION_FILE_SIZE.test(raw) || NOTION_FILE_SIZE.test(log),
    titleKey: "error.notion.fileSize",
    hintKey: "error.notion.fileSize.hint",
  },
  {
    test: (raw, _log) => NOTION_API.test(raw),
    titleKey: "error.notion.api",
    hintKey: "error.notion.api.hint",
  },
  {
    test: (raw, log) => SCORM_ITEM.test(raw) || SCORM_ITEM.test(log),
    titleKey: "error.scorm.item",
    hintKey: "error.scorm.item.hint",
  },
  {
    test: (raw, log) => SCORM_URL.test(raw) || SCORM_URL.test(log),
    titleKey: "error.scorm.url",
    hintKey: "error.scorm.url.hint",
  },
  {
    test: (raw, log) => CACHE_INVALID.test(raw) || CACHE_INVALID.test(log),
    titleKey: "error.cache.invalid",
    hintKey: "error.cache.invalid.hint",
  },
  {
    test: (raw, _log) => FILESYSTEM.test(raw),
    titleKey: "error.filesystem",
    hintKey: "error.filesystem.hint",
  },
  {
    test: (raw, _log) => NETWORK.test(raw),
    titleKey: "error.network",
    hintKey: "error.network.hint",
  },
  // Process-level crash patterns are last so more specific matches win first.
  {
    test: (raw, _log) => NODE_BANNER.test(raw) || PROCESS_CRASH.test(raw),
    titleKey: "error.process.crashed",
    hintKey: "error.process.crashed.hint",
  },
];

const LOG_TAIL_SIZE = 8;

function joinLogTail(logs: LogEntry[]): string {
  if (!logs.length) return "";
  const tail = logs.slice(-LOG_TAIL_SIZE);
  return tail.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n");
}

export function classifyJobError(
  rawError: string | null,
  _command: Command,
  logs: LogEntry[],
): ClassifiedError {
  const raw = (rawError ?? "").trim();
  const logTail = joinLogTail(logs);
  const technicalDetails = raw || logTail ? `${raw}\n\n${logTail}`.trim() : null;

  for (const pattern of PATTERNS) {
    if (pattern.test(raw, logTail)) {
      return {
        titleKey: pattern.titleKey,
        hintKey: pattern.hintKey,
        technicalDetails,
        isAuthIssue: !!pattern.isAuthIssue,
      };
    }
  }

  return {
    titleKey: "error.generic",
    hintKey: "error.generic.hint",
    technicalDetails,
    isAuthIssue: false,
  };
}
