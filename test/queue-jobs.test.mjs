import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createJob } from "../scripts/backend/web/jobs.mjs";

function fakeChild() {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345, connected: true, messages: [],
    send(message, callback) { this.messages.push(message); callback?.(); }, kill() { return true; } });
  return child;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("checkpoint ACK follows durable write and job completes only once after close", async () => {
  const child = fakeChild(); let release;
  const saved = new Promise((resolve) => { release = resolve; });
  const job = createJob({ command: "notion-publish", onCheckpoint: async (message) => {
    assert.equal(message.pid, child.pid); await saved;
  }, spawnProcess: () => child });
  child.emit("message", { type: "checkpoint", requestId: "one", stage: "worker-start", pid: 1 });
  await tick(); assert.equal(child.messages.length, 0);
  child.emit("exit", 0, null); assert.equal(job.status, "running");
  release(); await tick(); assert.equal(child.messages[0].ok, true);
  child.stdout.end(JSON.stringify({ title: "Example", notionPageUrl: "https://www.notion.so/example" }));
  child.stderr.end(); await tick(); child.emit("close", 0, null); child.emit("close", 0, null);
  await job.completion;
  assert.equal(job.status, "success");
  assert.equal(job.finalUrl, "https://www.notion.so/example");
  assert.equal(job.events.filter((e) => e.type === "done").length, 1);
});

test("failed checkpoint refuses acknowledgement and produces a storage failure", async () => {
  const child = fakeChild();
  const job = createJob({ command: "notion-publish", onCheckpoint: async () => { throw new Error("Cannot persist checkpoint"); }, spawnProcess: () => child });
  child.emit("message", { type: "checkpoint", requestId: "two", stage: "creating-page" });
  await tick(); assert.equal(child.messages[0].ok, false);
  child.stdout.end(); child.stderr.end(); child.emit("close", 1, null); await job.completion;
  assert.equal(job.errorCode, "queue-storage");
});

test("spawn error waits for close before finalizing", async () => {
  const child = fakeChild();
  const job = createJob({ command: "notion-publish", spawnProcess: () => child });
  child.emit("error", new Error("spawn failed")); assert.equal(job.status, "running");
  child.stdout.end(); child.stderr.end(); child.emit("close", -2, null);
  await job.completion; assert.equal(job.status, "failed"); assert.equal(job.error, "spawn failed");
});
