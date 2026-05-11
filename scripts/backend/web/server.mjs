import http from "node:http";

import { DEFAULT_NOTION_PARENT_PAGE_TITLE } from "../shared/env.mjs";
import {
  cancelJob,
  configStatus,
  createJob,
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
  if (url.pathname === "/api/config/defaults" && request.method === "GET") {
    writeJson(response, 200, loadSafeDefaults());
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

    const job = createJob({
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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    if (!response.headersSent) {
      writeError(response, 500, error.message || "Internal server error.");
    } else {
      response.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SCORM to Notion API listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  for (const job of runningJobs()) {
    cancelJob(job);
  }
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
