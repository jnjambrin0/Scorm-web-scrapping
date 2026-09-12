import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acquireBrowserProfileLock,
  BrowserProfileBusyError,
  externalBrowserPids,
  isBrowserProfileConflict,
  parseBrowserProfileLock,
  readBrowserProfileLock,
} from "../scripts/backend/browser/context.mjs";

test("recognizes native Chromium messages for an already-open profile", () => {
  assert.equal(isBrowserProfileConflict("SingletonLock: profile in use"), true);
  assert.equal(
    isBrowserProfileConflict("Failed to launch because user data directory is already in use"),
    true,
  );
  assert.equal(isBrowserProfileConflict("Executable doesn't exist"), false);
});

test("detects an external Chromium process using the profile", () => {
  const profileDir = "/tmp/scorm-profile";
  const psOutput = [
    "101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/scorm-profile",
    "102 node scripts/blackboard-browser.mjs login",
    "103 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/other-profile",
  ].join("\n");
  assert.deepEqual(externalBrowserPids(profileDir, psOutput, 999), [101]);
});

test("profile lock prevents a second owner and releases cleanly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-profile-lock-"));
  const profileDir = path.join(root, "profile");
  const release = await acquireBrowserProfileLock(profileDir);

  await assert.rejects(
    () => acquireBrowserProfileLock(profileDir),
    (error) => error instanceof BrowserProfileBusyError,
  );

  await release();
  const secondRelease = await acquireBrowserProfileLock(profileDir);
  await secondRelease();
  await fs.rm(root, { recursive: true, force: true });
});

test("reclaims a stale lock and exposes only safe owner metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-profile-lock-"));
  const profileDir = path.join(root, "profile");
  await fs.mkdir(path.dirname(profileDir), { recursive: true });
  await fs.writeFile(
    `${profileDir}.lock`,
    JSON.stringify({
      pid: 999999,
      nonce: "stale-nonce",
      createdAt: "2026-09-12T10:00:00.000Z",
      command: "check-session",
      jobId: "job-1",
    }),
    "utf8",
  );

  assert.deepEqual(parseBrowserProfileLock(await fs.readFile(`${profileDir}.lock`, "utf8")), {
    pid: 999999,
    nonce: "stale-nonce",
    createdAt: "2026-09-12T10:00:00.000Z",
    command: "check-session",
    jobId: "job-1",
  });
  const release = await acquireBrowserProfileLock(profileDir, {
    command: "notion-dry-run",
    jobId: "job-2",
  });
  const owner = await readBrowserProfileLock(profileDir);
  assert.equal(owner?.command, "notion-dry-run");
  assert.equal(owner?.jobId, "job-2");
  await release();
  assert.equal(await readBrowserProfileLock(profileDir), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("waits for another process to finish writing lock metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-profile-lock-"));
  const profileDir = path.join(root, "profile");
  await fs.mkdir(path.dirname(profileDir), { recursive: true });
  await fs.writeFile(`${profileDir}.lock`, "", "utf8");
  const metadataTimer = setTimeout(() => {
    void fs.writeFile(
      `${profileDir}.lock`,
      JSON.stringify({ pid: 999999, nonce: "stale", createdAt: "2026-09-12T10:00:00.000Z" }),
      "utf8",
    );
  }, 10);

  const release = await acquireBrowserProfileLock(profileDir);
  clearTimeout(metadataTimer);
  await release();
  await fs.rm(root, { recursive: true, force: true });
});
