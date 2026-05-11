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
const PROCESS_CRASH = /Job failed with code/;

const PATTERNS: ReadonlyArray<Pattern> = [
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
