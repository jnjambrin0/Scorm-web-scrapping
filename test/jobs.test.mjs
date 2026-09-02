import test from "node:test";
import assert from "node:assert/strict";

import {
  browserJobRunning,
  normalizeFlags,
} from "../scripts/backend/web/jobs.mjs";

test("normalizes the explicit remote session-check flag", () => {
  assert.deepEqual(normalizeFlags({ remote: true }), {
    refresh: false,
    deleteAfter: false,
    remote: true,
  });
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
});
