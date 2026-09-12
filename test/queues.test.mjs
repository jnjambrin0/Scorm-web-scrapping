import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QueueManager, queueConfig } from "../scripts/backend/web/queues.mjs";
import { createAdmission } from "../scripts/backend/web/admission.mjs";
import { fileQueueStore } from "../scripts/backend/web/queue-store.mjs";
import { jobFailureCode } from "../scripts/backend/shared/job-failure.mjs";

const url = "https://u-tad.blackboard.com/ultra/courses/_14390_1/scorm/overview/_689299_1";
const input = (title = "") => ({ url, title, parentTitle: "Universidad", parentId: "", scormTitle: "", refresh: false, paidPlan: true, mediaWidthRatio: 0.85 });
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) { for (let n = 0; n < 100; n++) { if (predicate()) return; await tick(); } assert.fail("State did not settle"); }

async function harness(initial = null) {
  let saved = initial;
  let writeFailure = false;
  let profile = { state: "available" };
  const jobs = [];
  let manager;
  const store = { load: async () => saved || { schemaVersion: 1, revision: 0, batches: [], operations: {} }, save: async (state) => { if (writeFailure) throw new Error("disk full"); saved = structuredClone(state); } };
  const admission = createAdmission({
    active: () => jobs.find((job) => job.status === "running"), inspect: async () => { await tick(); return profile; },
    reserved: () => manager.reserved(), reuse: () => false, serialize: (job) => job && { id: job.id, status: job.status },
    create: (request) => {
      let resolve;
      const job = { ...request, status: "running", completion: new Promise((done) => { resolve = done; }),
        finish(status = "success", extra = {}) { Object.assign(this, { status, finishedAt: new Date().toISOString() }, extra); resolve(this); manager.kick(); } };
      jobs.push(job); return job;
    },
  });
  manager = new QueueManager({ store, admission, cancel: (job) => job.finish("cancelled"),
    getJob: (id) => jobs.find((j) => j.id === id), serializeJob: (job) => job ? { id: job.id, status: job.status } : null,
    alive: (pid) => pid === 99999 });
  await manager.init();
  const mutate = (action, extra = {}) => manager.mutate({ action, revision: manager.snapshot().revision, operationId: crypto.randomUUID(), batchId: manager.snapshot().batches.at(-1)?.id, ...extra });
  return { manager, jobs, admission, mutate, snapshot: () => manager.snapshot(), saved: () => structuredClone(saved),
    setProfile: (next) => { profile = next; }, setWriteFailure: () => { writeFailure = true; } };
}

test("source and destination snapshots preserve the exact URL and explicit empty title", () => {
  const c = queueConfig({ ...input(), url: `${url}?custom=1#fragment` });
  assert.equal(c.url, `${url}?custom=1`);
  assert.equal(c.title, "");
  assert.equal(c.parentTitle, "Universidad");
  assert.throws(() => queueConfig({ ...input(), url: "javascript:alert(1)" }));
  assert.throws(() => queueConfig({ ...input(), parentId: "not-an-id" }));
  assert.throws(() => queueConfig({ ...input(), url: "https://u-tad.blackboard.com/ultra/courses/_1/outline" }));
});

test("ten per batch, including finished jobs; removing a pending item frees its slot", async () => {
  const h = await harness(); await h.mutate("create");
  await assert.rejects(h.mutate("start"), { code: "queue-empty" });
  for (let i = 0; i < 10; i++) await h.mutate("add", { config: input(String(i)) });
  await assert.rejects(h.mutate("add", { config: input("11") }), { code: "queue-full" });
  const first = h.snapshot().batches[0].items[0];
  await h.mutate("remove", { itemId: first.id }); await h.mutate("add", { config: input("replacement") });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  await h.mutate("pause"); h.jobs[0].finish(); await until(() => h.snapshot().batches[0].items[0].status === "success");
  await assert.rejects(h.mutate("add", { config: input("11") }), { code: "queue-full" });
});

test("live edits, removal and reordering affect only pending jobs and destination snapshots", async () => {
  const h = await harness(); await h.mutate("create");
  for (const title of ["one", "two", "three"]) await h.mutate("add", { config: input(title) });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  const [a, b, c] = h.snapshot().batches[0].items;
  await assert.rejects(h.mutate("edit", { itemId: a.id, config: input("wrong") }), { code: "item-started" });
  await h.mutate("edit", { itemId: c.id, config: { ...input("new title"), parentTitle: "Different parent" } });
  await h.mutate("reorder", { order: [c.id, b.id] });
  await h.mutate("remove", { itemId: b.id });
  await h.mutate("add", { config: input("four") });
  h.jobs[0].finish(); await until(() => h.jobs.length === 2);
  assert.equal(h.jobs[1].envOverrides.NOTION_PAGE_TITLE, "new title");
  assert.equal(h.jobs[1].envOverrides.NOTION_PARENT_PAGE_TITLE, "Different parent");
  assert.equal(h.jobs[1].envOverrides.COURSE_OUTLINE_URL, url);
  assert.equal(h.jobs[1].flags.deleteAfter, false);
  h.jobs[1].finish(); await until(() => h.jobs.length === 3); h.jobs[2].finish();
  await until(() => h.snapshot().batches[0].status === "completed");
  h.manager.kick(); await tick(); assert.equal(h.jobs.length, 3);
});

test("double clicks are idempotent and concurrent stale changes are rejected", async () => {
  const h = await harness(); await h.mutate("create");
  const body = { operationId: crypto.randomUUID(), revision: h.snapshot().revision, action: "add", batchId: h.snapshot().batches[0].id, config: input() };
  await Promise.all([h.manager.mutate(body), h.manager.mutate(body)]);
  assert.equal(h.snapshot().batches[0].items.length, 1);
  await assert.rejects(h.manager.mutate({ ...body, operationId: crypto.randomUUID() }), { code: "revision-conflict" });
  await assert.rejects(h.manager.mutate({ ...body, config: input("changed") }), { code: "operation-conflict" });
});

test("queue persistence ignores request fields outside the public contract", async () => {
  const h = await harness(); await h.mutate("create");
  await h.mutate("add", { config: { ...input(), cookie: "do-not-store" }, token: "do-not-store", order: ["do-not-store"] });
  assert.equal(JSON.stringify(h.saved()).includes("do-not-store"), false);
});

test("admission serializes simultaneous requests across asynchronous profile inspection", async () => {
  const h = await harness();
  const results = await Promise.allSettled([h.admission.start({ command: "export-md" }), h.admission.start({ command: "check-session" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(h.jobs.length, 1);
});

test("queue waits for an existing job and reserves the executor between items", async () => {
  const h = await harness(); const prior = await h.admission.start({ command: "check-session" });
  await h.mutate("create"); await h.mutate("add", { config: input() }); await h.mutate("start");
  await tick(); assert.equal(h.jobs.length, 1);
  prior.finish(); await until(() => h.jobs.length === 2);
  await assert.rejects(h.admission.start({ command: "export-md" }));
});

test("an item failure continues; session failure blocks until explicit recovery", async () => {
  const h = await harness(); await h.mutate("create");
  for (let i = 0; i < 3; i++) await h.mutate("add", { config: input(String(i)) });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  h.jobs[0].finish("failed", { error: "SCORM content unavailable", errorCode: "job-failed" });
  await until(() => h.jobs.length === 2);
  h.jobs[1].finish("failed", { error: "Blackboard bootstrap requires login.", errorCode: "session-required" });
  await until(() => h.snapshot().batches[0].status === "paused");
  assert.equal(h.snapshot().batches[0].items[1].status, "blocked");
  assert.equal(h.jobs.length, 2);
  await h.mutate("resume"); await until(() => h.jobs.length === 3);
  assert.equal(h.snapshot().batches[0].items[1].attempts.length, 2);
});

test("cancel current pauses, while stopping cancels all pending items", async () => {
  const h = await harness(); await h.mutate("create");
  for (let i = 0; i < 3; i++) await h.mutate("add", { config: input() });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  await h.mutate("cancel-current"); await until(() => h.snapshot().batches[0].items[0].status === "cancelled");
  assert.equal(h.snapshot().batches[0].status, "paused"); assert.equal(h.jobs.length, 1);
  await h.mutate("resume"); await until(() => h.jobs.length === 2);
  await h.mutate("stop"); await until(() => h.snapshot().batches[0].items[1].status === "cancelled");
  assert.equal(h.snapshot().batches[0].items[2].status, "cancelled");
  assert.equal(h.snapshot().batches[0].status, "stopped");
});

test("page-created checkpoint survives failure and retry requires review", async () => {
  const h = await harness(); await h.mutate("create"); await h.mutate("add", { config: input() });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  const job = h.jobs[0];
  await job.onCheckpoint({ stage: "creating-page", title: "Detected title" });
  await job.onCheckpoint({ stage: "page-created", pageId: "page-id", pageUrl: "https://www.notion.so/page-id?private=token" });
  assert.equal(h.saved().batches[0].items[0].attempts[0].notionPageUrl, "https://www.notion.so/page-id");
  job.finish("failed", { error: "Append failed https://host/path?token=private", errorCode: "job-failed" });
  await until(() => h.snapshot().batches[0].items[0].status === "incomplete");
  const item = h.snapshot().batches[0].items[0];
  assert.equal(item.attempts[0].error.includes("private"), false);
  await assert.rejects(h.mutate("retry", { itemId: item.id }), { code: "publication-review" });
  await h.mutate("retry", { itemId: item.id, confirmNewPage: true });
  assert.equal(h.jobs.length, 1);
  assert.equal(h.snapshot().batches[0].status, "paused");
});

test("restart pauses pending work, marks uncertain publication and blocks a surviving worker", async () => {
  const h = await harness(); await h.mutate("create");
  await h.mutate("add", { config: input() }); await h.mutate("add", { config: input("next") });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  await h.jobs[0].onCheckpoint({ stage: "worker-start", pid: 99999 });
  await h.jobs[0].onCheckpoint({ stage: "creating-page" });
  const recovered = await harness(h.saved());
  assert.equal(recovered.snapshot().batches[0].status, "paused");
  assert.equal(recovered.snapshot().batches[0].items[0].status, "interrupted");
  assert.equal(recovered.jobs.length, 0);
  await recovered.mutate("resume"); await until(() => recovered.snapshot().batches[0].reason === "worker-alive");
  assert.equal(recovered.jobs.length, 0);
  assert.equal(JSON.stringify(recovered.snapshot()).includes("99999"), false);
});

test("external profile and storage failures prevent new workers", async () => {
  const h = await harness(); await h.mutate("create"); await h.mutate("add", { config: input() });
  h.setProfile({ state: "external-browser" }); await h.mutate("start");
  await until(() => h.snapshot().batches[0].reason === "profile-busy"); assert.equal(h.jobs.length, 0);
  h.setWriteFailure();
  await assert.rejects(h.mutate("resume"), { code: "queue-storage" });
  assert.equal(h.snapshot().storageError, "queue-storage");
  assert.equal(h.jobs.length, 0);
});

test("file store round-trips and does not replace corrupt state with an empty queue", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-queue-test-"));
  try {
    const file = path.join(dir, "queue.json"); const store = fileQueueStore(file);
    const state = await store.load(); await store.save(state); assert.deepEqual(await store.load(), state);
    await fs.writeFile(file, "{bad");
    await assert.rejects(store.load(), /No se puede leer/);
    assert.equal(await fs.readFile(file, "utf8"), "{bad");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("SSE recovery sends authoritative snapshots even when the cursor is older than history", async () => {
  const h = await harness(); await h.mutate("create");
  const { EventEmitter } = await import("node:events"); const request = new EventEmitter();
  request.headers = { "last-event-id": "999" }; const output = [];
  h.manager.stream(request, { writeHead() {}, write(value) { output.push(value); } });
  request.emit("close");
  assert.match(output.join(""), /event: snapshot/);
  assert.match(output.join(""), /"status":"draft"/);
  assert.equal(h.jobs.length, 0);
});

test("auth classification uses stable codes for production errors", () => {
  assert.equal(jobFailureCode("Blackboard bootstrap requires login. Final destination: https://login.microsoftonline.com/"), "session-required");
  assert.equal(jobFailureCode("Blackboard session expired or login is required."), "session-required");
  assert.equal(jobFailureCode("BrowserProfileBusyError: Browser profile is already in use"), "profile-busy");
  assert.equal(jobFailureCode("SCORM player was opened but its content surface did not become ready."), "job-failed");
});

test("a durable completed checkpoint recovers success even if the final response was lost", async () => {
  const h = await harness(); await h.mutate("create"); await h.mutate("add", { config: input("Custom title") });
  await h.mutate("start"); await until(() => h.jobs.length === 1);
  await h.jobs[0].onCheckpoint({ stage: "completed", title: "Custom title", pageUrl: "https://www.notion.so/complete", summary: { lessons: 14, secret: "must-not-persist" } });
  const restored = await harness(h.saved());
  const batch = restored.snapshot().batches[0];
  assert.equal(batch.status, "completed");
  assert.equal(batch.items[0].status, "success");
  assert.equal(batch.items[0].attempts[0].title, "Custom title");
  assert.equal(batch.items[0].attempts[0].summary.lessons, 14);
  assert.equal(JSON.stringify(restored.saved()).includes("must-not-persist"), false);
  assert.equal(restored.jobs.length, 0);
});

test("shutdown during profile inspection cannot spawn a late worker", async () => {
  let finishInspection; let spawned = 0;
  const gate = new Promise((resolve) => { finishInspection = resolve; });
  const admission = createAdmission({ active: () => null, inspect: () => gate, create: () => { spawned++; }, serialize: () => null, reuse: () => false });
  const attempt = admission.start({ command: "notion-publish" });
  await tick(); admission.stop(); finishInspection({ state: "available" });
  await assert.rejects(attempt, { code: "shutdown" });
  assert.equal(spawned, 0);
});

test("only one server can own a durable queue, even on different HTTP ports", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-queue-owner-"));
  const a = fileQueueStore(path.join(dir, "queue.json"));
  const b = fileQueueStore(path.join(dir, "queue.json"));
  try {
    await a.acquire();
    await assert.rejects(b.acquire(), { code: "queue-owner" });
    await a.release();
    await b.acquire(); await b.release();
  } finally { await a.release(); await b.release(); await fs.rm(dir, { recursive: true, force: true }); }
});

test("simultaneous stale writer recovery never removes the new owner's lease", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-queue-owner-stale-"));
  const filename = path.join(dir, "queue.json");
  const lockDirectory = `${filename}.writer`;
  await fs.mkdir(lockDirectory);
  await fs.writeFile(path.join(lockDirectory, `owner-2147483647-${crypto.randomUUID()}`), "");
  const stores = [fileQueueStore(filename), fileQueueStore(filename)];
  try {
    const outcomes = await Promise.allSettled(stores.map((s) => s.acquire()));
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    const entries = await fs.readdir(lockDirectory);
    assert.equal(entries.length, 1); assert.match(entries[0], new RegExp(`^owner-${process.pid}-`));
  } finally { await Promise.all(stores.map((s) => s.release())); await fs.rm(dir, { recursive: true, force: true }); }
});
