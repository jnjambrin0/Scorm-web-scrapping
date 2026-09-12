import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { sanitizeText } from "../shared/text.mjs";
import { safeDiagnostic } from "../shared/job-failure.mjs";
import { ROOT } from "../shared/paths.mjs";
import { createAdmission } from "./admission.mjs";
import { QueueManager } from "./queues.mjs";
import { fileQueueStore } from "./queue-store.mjs";

import { inspectBrowserProfileUsage } from "../browser/context.mjs";
import { DEFAULT_NOTION_PARENT_PAGE_TITLE } from "../shared/env.mjs";
import {
  activeBrowserJob,
  canReuseRemoteSessionCheck,
  cancelJob,
  configStatus,
  createJob,
  jobEvents,
  getJob,
  normalizeEnvOverrides,
  normalizeFlags,
  runningJobs,
  serializeJob,
  streamJobEvents,
  validateCommandConfig,
} from "./jobs.mjs";
import {
  readRequestBody,
  serveStatic,
  writeError,
  writeJson,
} from "./http.mjs";

const HOST = process.env.WEB_HOST || "127.0.0.1";
const PORT = Number(process.env.WEB_PORT || 8787);
const admission = createAdmission({ active: activeBrowserJob, inspect: inspectBrowserProfileUsage,
  create: createJob, serialize: serializeJob, reuse: canReuseRemoteSessionCheck,
  reserved: () => queues.reserved() || !!queues.storageError });
const queues = new QueueManager({ store: fileQueueStore(path.join(ROOT, ".local-state", "queues.json")),
  admission, cancel: cancelJob, getJob, serializeJob, validate: validateCommandConfig });

const SUPPORTED_COMMANDS = new Set([
  "check-session",
  "export-md",
  "login",
  "notion-dry-run",
  "notion-publish",
]);

if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  console.error("Refusing to listen on a non-local host. Use 127.0.0.1.");
  process.exit(1);
}

function loadSafeDefaults() {
  return {
    notionParentPageTitle: DEFAULT_NOTION_PARENT_PAGE_TITLE,
    config: configStatus(),
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/queues/events" && request.method === "GET") {
    queues.stream(request, response); return;
  }
  if (url.pathname === "/api/queues" && request.method === "GET") {
    writeJson(response, 200, queues.snapshot()); return;
  }
  if (url.pathname === "/api/queues" && request.method === "POST") {
    writeJson(response, 200, await queues.mutate(await readRequestBody(request))); return;
  }
  if (url.pathname === "/api/config/defaults" && request.method === "GET") {
    writeJson(response, 200, loadSafeDefaults());
    return;
  }

  if (url.pathname === "/api/jobs/active" && request.method === "GET") {
    const profile = await inspectBrowserProfileUsage();
    writeJson(response, 200, {
      jobs: runningJobs().map(serializeJob),
      profile,
    });
    return;
  }

  if (url.pathname === "/api/jobs" && request.method === "POST") {
    const body = await readRequestBody(request);
    const command = body.command;
    if (!SUPPORTED_COMMANDS.has(command)) {
      writeError(response, 400, "Unsupported job command.");
      return;
    }

    const configIssue = validateCommandConfig(command);
    if (configIssue) {
      writeError(response, 400, configIssue.message);
      return;
    }

    const job = await admission.start({
      command,
      envOverrides: normalizeEnvOverrides(body.envOverrides),
      flags: normalizeFlags(body.flags),
    });
    writeJson(response, 201, serializeJob(job));
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(events|cancel))?$/);
  if (jobMatch) {
    const job = getJob(jobMatch[1]);
    if (!job) {
      writeError(response, 404, "Job not found.");
      return;
    }

    if (!jobMatch[2] && request.method === "GET") {
      writeJson(response, 200, serializeJob(job));
      return;
    }

    if (jobMatch[2] === "events" && request.method === "GET") {
      streamJobEvents(job, request, response);
      return;
    }

    if (jobMatch[2] === "cancel" && request.method === "POST") {
      if (job.queueBatchId && job.status === "running") {
        await queues.mutate({ action: "cancel-current", batchId: job.queueBatchId,
          revision: queues.snapshot().revision, operationId: crypto.randomUUID() });
        writeJson(response, 200, { cancelled: true, job: serializeJob(job) }); return;
      }
      const cancelled = cancelJob(job);
      writeJson(response, 200, {
        cancelled,
        job: serializeJob(job),
      });
      return;
    }
  }

  writeError(response, 404, "API route not found.");
}

let markReady;
const ready = new Promise((resolve) => { markReady = resolve; });
const server = http.createServer(async (request, response) => {
  try {
    await ready;
    const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    if (!response.headersSent) {
      writeJson(response, error.status || 500, { error: safeDiagnostic(sanitizeText(error.message || "Internal server error.")), code: error.code || null, busy: error.busy || null });
    } else {
      response.end();
    }
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, HOST, resolve);
});
await queues.init();
jobEvents.on("done", () => queues.kick());
markReady();
console.log(`SCORM to Notion API listening on http://${HOST}:${PORT}`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  admission.stop();
  await queues.shutdown();
  const active = runningJobs();
  for (const job of active) {
    cancelJob(job);
  }
  server.close();
  await Promise.all(active.map((job) => job.completion));
  await queues.tail;
  await queues.store.release?.();
  server.closeAllConnections();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
