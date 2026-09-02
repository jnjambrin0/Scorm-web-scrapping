import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { backupBrowserProfile } from "../scripts/backend/browser/reset-profile.mjs";

test("moves the browser profile to a reversible dated backup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-profile-reset-"));
  const profileDir = path.join(root, "profile");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, "marker.txt"), "profile data", "utf8");

  const result = await backupBrowserProfile(profileDir, {
    now: new Date("2026-09-02T10:20:30.000Z"),
  });

  assert.equal(result.status, "moved");
  assert.equal(await fs.access(profileDir).then(() => true).catch(() => false), false);
  assert.equal(
    await fs.readFile(path.join(result.backupDir, "marker.txt"), "utf8"),
    "profile data",
  );
  assert.match(result.backupDir, /profile\.backup-20260902T102030000Z$/);

  await fs.rm(root, { recursive: true, force: true });
});

test("reports an already-clean profile without creating a destructive action", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-profile-reset-"));
  const result = await backupBrowserProfile(path.join(root, "missing-profile"));
  assert.deepEqual(result.status, "missing");
  await fs.rm(root, { recursive: true, force: true });
});
