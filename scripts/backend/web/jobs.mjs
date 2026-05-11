import { spawn } from "node:child_process";
import crypto from "node:crypto";

import {
  configuredBlackboardBaseUrl,
  configuredNotionApiKey,
} from "../shared/env.mjs";
import { ROOT } from "../shared/paths.mjs";
import { sanitizeText } from "../shared/text.mjs";

const EVENT_HISTORY_LIMIT = 1000;

// Lines that look like errors but are just noise from the runtime. We strip
// them before picking the "last line" as the user-facing error message so a
// bare `Node.js v24.12.0` banner — or a closing brace from a dumped Error
// object — never reaches the UI.
const ERROR_NOISE_PATTERNS = [
  /^Node\.js v[\d.]+$/,
  /^\(node:\d+\) /,
  /^Debugger (?:attached|listening)/,
  /^For help, see: /,
  // Stack frames printed by Node / Playwright.
  /^at\s+/,
  // Property dumps from Error objects: `name: 'Error'`, `code: 'ERR_X'`, etc.
  /^[A-Za-z_$][\w$]*: ['"]?[\w-]*['"]?,?$/,
  // Bare structural punctuation that survives after we strip stack frames.
  /^[{}()[\];,]+$/,
  // Playwright "Call log:" header — the useful entries follow on later lines.
  /^Call log:?$/,
  // Bare type names like "Error" or "TypeError:".
  /^[A-Z][A-Za-z]+(?:Error)?:?$/,
];

// Strong signals that a line is the actual error message rather than incidental
// stderr noise. Ordered by specificity; the first match wins from the top of
// the stream. This catches Chromium net codes (`net::ERR_*`) and Playwright's
// `apiName: message` headers as well as the classic `XxxError: ...` prefix.
const STRONG_ERROR_SIGNALS = [
  /\bnet::ERR_[A-Z_]+/,
  /^[A-Z][A-Za-z]+Error: /,
  /^\w+(?:\.\w+)+:\s+\S/,
];

function pickMeaningfulError(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Prefer the first strong-signal line — these are the headlines Node and
  // Playwright print right before the stack trace.
  for (const line of lines) {
    if (STRONG_ERROR_SIGNALS.some((re) => re.test(line))) {
      return line;
    }
  }
  // Otherwise walk from the bottom, skipping noise, to find the last
  // substantive line emitted before the process died.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!ERROR_NOISE_PATTERNS.some((re) => re.test(line))) {
      return line;
    }
  }
  return null;
}

const ALLOWED_ENV_OVERRIDES = new Set([
  "COURSE_OUTLINE_URL",
  "SCORM_TITLE",
  "SCORM_MARKDOWN_OUT",
  "NOTION_PARENT_PAGE_ID",
  "NOTION_PARENT_PAGE_TITLE",
  "NOTION_PAGE_TITLE",
  "NOTION_MEDIA_WIDTH_RATIO",
  "NOTION_PAID_PLAN",
]);

/**
 * Returns a structured config issue when the given command can't run because
 * a required `.env` value is missing. The HTTP layer turns this into a 400 so
 * the user sees a clear "configure X" message instead of an opaque crash.
 */
export function validateCommandConfig(command) {
  if (command === "notion-publish" || command === "notion-dry-run") {
    if (!configuredNotionApiKey()) {
      return {
        code: "missing-notion-api-key",
        message:
          "NOTION_API_KEY no está configurada en tu .env. Crea una integración en notion.so/profile/integrations y pega el token allí.",
      };
    }
  }
  if (command === "login" || command === "check-session") {
    if (!configuredBlackboardBaseUrl()) {
      return {
        code: "missing-blackboard-base-url",
        message:
          "BLACKBOARD_BASE_URL no está configurada en tu .env. Añade la URL base de tu Blackboard (p. ej. https://<tu-institución>.blackboard.com/ultra/stream).",
      };
    }
  }
  return null;
}

export function configStatus() {
  return {
    hasNotionApiKey: !!configuredNotionApiKey(),
    hasBlackboardBaseUrl: !!configuredBlackboardBaseUrl(),
    blackboardBaseUrl: configuredBlackboardBaseUrl(),
  };
}

const jobs = new Map();

export function getJob(id) {
  return jobs.get(id) || null;
}

export function runningJobs() {
  return [...jobs.values()].filter((job) => job.status === "running");
}

export function normalizeEnvOverrides(value) {
  const input = value && typeof value === "object" ? value : {};
  const result = {};

  for (const [key, rawValue] of Object.entries(input)) {
    if (!ALLOWED_ENV_OVERRIDES.has(key)) {
      continue;
    }
    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed.length > 2000) {
      continue;
    }
    result[key] = trimmed;
  }

  return result;
}

export function normalizeFlags(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    refresh: Boolean(input.refresh),
    deleteAfter: Boolean(input.deleteAfter),
  };
}

function commandArgs(command, flags) {
  if (command === "check-session") {
    return ["scripts/blackboard-browser.mjs", "check-session"];
  }
  if (command === "login") {
    return ["scripts/blackboard-browser.mjs", "login"];
  }
  if (command === "export-md") {
    return ["scripts/export-scorm-markdown.mjs"];
  }
  if (command === "notion-dry-run") {
    return [
      "scripts/export-scorm-notion.mjs",
      "--dry-run",
      ...(flags.refresh ? ["--refresh"] : []),
    ];
  }
  if (command === "notion-publish") {
    return [
      "scripts/export-scorm-notion.mjs",
      "--publish",
      ...(flags.refresh ? ["--refresh"] : []),
      ...(flags.deleteAfter ? ["--delete-after"] : []),
    ];
  }

  throw new Error(`Unsupported command: ${command}`);
}

export function serializeJob(job) {
  return {
    id: job.id,
    command: job.command,
    status: job.status,
    currentPhase: job.currentPhase,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    signal: job.signal,
    summary: job.summary,
    finalUrl: job.finalUrl,
    error: job.error,
  };
}

function sendSse(response, event) {
  response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

function addEvent(job, type, payload) {
  const event = {
    id: String(++job.eventSeq),
    type,
    payload: {
      at: new Date().toISOString(),
      ...payload,
    },
  };

  job.events.push(event);
  if (job.events.length > EVENT_HISTORY_LIMIT) {
    job.events.shift();
  }

  for (const client of job.clients) {
    sendSse(client, event);
  }
}

function inferPhase(line) {
  if (/Starting SCORM to Notion export|Profile dir|Mode:/.test(line)) {
    return "starting";
  }
  if (/Loading cached SCORM|Refreshing Markdown|Loaded Markdown|Refreshed Markdown|Exported|outPath/.test(line)) {
    return "markdown";
  }
  if (/Collected \d+ media|Restored \d+ assets|Downloading asset|Downloaded asset|Asset manifest/.test(line)) {
    return "assets";
  }
  if (/Notion client initialized|Searching Notion parent|Using Notion parent|Resolving Notion parent/.test(line)) {
    return "notion-parent";
  }
  if (/Uploading \d+ assets|Uploading asset|Uploaded asset|Sending upload part|Reusing Notion upload|Finished uploading/.test(line)) {
    return "upload";
  }
  if (/Creating Notion page|Notion page created/.test(line)) {
    return "create-page";
  }
  if (/Appending \d+ Notion blocks|Appended block batch/.test(line)) {
    return "append-blocks";
  }
  if (/Moving validation page|Publish complete|Dry-run complete/.test(line)) {
    return "done";
  }
  return null;
}

function progressFromLine(line) {
  let match = line.match(/(?:Uploading|Uploaded) asset (\d+)\/(\d+)/);
  if (match) {
    return {
      kind: "assets",
      current: Number(match[1]),
      total: Number(match[2]),
    };
  }

  match = line.match(/Sending upload part (\d+)\/(\d+)/);
  if (match) {
    return {
      kind: "upload-parts",
      current: Number(match[1]),
      total: Number(match[2]),
    };
  }

  match = line.match(/Appended block batch (\d+)\/(\d+)/);
  if (match) {
    return {
      kind: "block-batches",
      current: Number(match[1]),
      total: Number(match[2]),
    };
  }

  return null;
}

function emitLine(job, stream, rawLine) {
  const line = sanitizeText(rawLine);
  if (!line.trim()) {
    return;
  }

  const phase = inferPhase(line);
  if (phase && phase !== job.currentPhase) {
    job.currentPhase = phase;
    addEvent(job, "phase", {
      phase,
      message: line,
      progress: progressFromLine(line),
    });
  } else if (phase) {
    addEvent(job, "phase", {
      phase,
      message: line,
      progress: progressFromLine(line),
    });
  }

  addEvent(job, "log", {
    stream,
    line,
  });
}

function splitLines(stream, onLine) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on("end", () => {
    if (pending) {
      onLine(pending);
    }
  });
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractCreatedPageUrl(text, summary) {
  if (summary?.notionPageUrl) {
    return summary.notionPageUrl;
  }

  const match = text.match(/(?:Created page|Notion page):\s*(https:\/\/\S+)/);
  return match ? match[1] : null;
}

function shouldStreamStdoutLine(command, line) {
  if (!command.startsWith("notion-")) {
    return true;
  }

  return /^(Final report:|Parent page:|Created page:|Status:)/.test(line);
}

export function createJob({ command, envOverrides, flags }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    command,
    status: "running",
    currentPhase: "starting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    signal: null,
    summary: null,
    finalUrl: null,
    error: null,
    eventSeq: 0,
    events: [],
    clients: new Set(),
    child: null,
    stdout: "",
    stderr: "",
    cancelRequested: false,
  };
  jobs.set(id, job);

  addEvent(job, "phase", {
    phase: "starting",
    message: `Starting ${command}`,
  });

  const childEnv = {
    ...process.env,
    ...envOverrides,
  };
  if (envOverrides.COURSE_OUTLINE_URL && !childEnv.BLACKBOARD_URL) {
    childEnv.BLACKBOARD_URL = envOverrides.COURSE_OUTLINE_URL;
  }

  const child = spawn(process.execPath, commandArgs(command, flags), {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;

  splitLines(child.stdout, (line) => {
    job.stdout += `${line}\n`;
    if (shouldStreamStdoutLine(command, line)) {
      emitLine(job, "stdout", line);
    }
  });
  splitLines(child.stderr, (line) => {
    job.stderr += `${line}\n`;
    emitLine(job, "stderr", line);
  });

  child.on("exit", (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.finishedAt = new Date().toISOString();

    const combinedOutput = `${job.stdout}\n${job.stderr}`;
    const summary = extractFirstJsonObject(job.stdout);
    if (summary) {
      job.summary = summary;
      job.finalUrl = extractCreatedPageUrl(combinedOutput, summary);
      addEvent(job, "summary", {
        summary,
        finalUrl: job.finalUrl,
      });
    }

    if (job.cancelRequested) {
      job.status = "cancelled";
      job.error = "Job cancelled.";
    } else if (code === 0) {
      job.status = "success";
    } else {
      job.status = "failed";
      job.error = sanitizeText(
        pickMeaningfulError(job.stderr) ||
          pickMeaningfulError(job.stdout) ||
          `Job failed with code ${code ?? signal}`,
      );
      addEvent(job, "error", { message: job.error });
    }

    addEvent(job, "done", { job: serializeJob(job) });
  });

  child.on("error", (error) => {
    job.status = "failed";
    job.error = sanitizeText(error.message);
    job.finishedAt = new Date().toISOString();
    addEvent(job, "error", { message: job.error });
    addEvent(job, "done", { job: serializeJob(job) });
  });

  return job;
}

export function cancelJob(job) {
  if (!job || job.status !== "running" || !job.child) {
    return false;
  }

  job.cancelRequested = true;
  emitLine(job, "system", "Cancellation requested.");
  job.child.kill("SIGINT");
  setTimeout(() => {
    if (job.status === "running" && !job.child.killed) {
      job.child.kill("SIGTERM");
    }
  }, 3000).unref();
  return true;
}

export function streamJobEvents(job, request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.write(": connected\n\n");
  for (const event of job.events) {
    sendSse(response, event);
  }
  job.clients.add(response);
  request.on("close", () => {
    job.clients.delete(response);
  });
}
