import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  activeBrowserJob,
  browserJobRunning,
  cancelJob,
  normalizeFlags,
  streamJobEvents,
} from "../scripts/backend/web/jobs.mjs";

test("normalizes the explicit remote session-check flag", () => {
  assert.deepEqual(normalizeFlags({ remote: true }), {
    refresh: false,
    deleteAfter: false,
    remote: true,
    interactive: false,
  });
  assert.equal(normalizeFlags({ remote: true, interactive: true }).interactive, true);
  assert.equal(normalizeFlags({ remote: "yes" }).remote, true);
  assert.equal(normalizeFlags({ remote: false }).remote, false);
});

test("recognizes every browser-backed command as profile-exclusive", () => {
  assert.equal(
    browserJobRunning([
      { status: "running", command: "notion-dry-run" },
    ]),
    true,
  );
  assert.equal(
    browserJobRunning([
      { status: "running", command: "notion-publish" },
    ]),
    true,
  );
  assert.equal(
    browserJobRunning([
      { status: "running", command: "check-session" },
    ]),
    true,
  );
  assert.equal(
    browserJobRunning([
      { status: "success", command: "notion-publish" },
    ]),
    false,
  );
  assert.equal(
    activeBrowserJob([
      { status: "running", command: "login", id: "active-login" },
    ]).id,
    "active-login",
  );
});

test("escalates cancellation even after SIGINT was successfully delivered", async () => {
  const signals = [];
  const child = {
    killed: false,
    kill(signal) {
      this.killed = true;
      signals.push(signal);
      return true;
    },
  };
  const job = {
    status: "running",
    child,
    cancelRequested: false,
    currentPhase: "starting",
    eventSeq: 0,
    events: [],
    clients: new Set(),
  };

  assert.equal(cancelJob(job, { graceMs: 5 }), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(signals, ["SIGINT", "SIGTERM"]);
});

test("replays only SSE events newer than Last-Event-ID", () => {
  const output = [];
  const request = new EventEmitter();
  request.headers = { "last-event-id": "1" };
  const response = {
    writeHead() {},
    write(chunk) {
      output.push(chunk);
    },
  };
  const job = {
    events: [
      { id: "1", type: "log", payload: { line: "old" } },
      { id: "2", type: "log", payload: { line: "new" } },
    ],
    clients: new Set(),
  };

  streamJobEvents(job, request, response);
  assert.equal(output.join("").includes("id: 1"), false);
  assert.equal(output.join("").includes("id: 2"), true);
});
