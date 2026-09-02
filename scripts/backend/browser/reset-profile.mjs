import fs from "node:fs/promises";
import path from "node:path";

import {
  acquireBrowserProfileLock,
  assertNoExternalBrowserProcess,
} from "./context.mjs";

function formatTimestamp(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.([0-9]+)Z$/, "$1Z");
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function uniqueBackupPath(profileDir, timestamp) {
  const base = `${profileDir}.backup-${formatTimestamp(timestamp)}`;
  if (!(await exists(base))) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  throw new Error(`Could not find a free backup path for ${profileDir}.`);
}

export async function backupBrowserProfile(profileDir, { now = new Date() } = {}) {
  const resolvedProfileDir = path.resolve(profileDir);
  const release = await acquireBrowserProfileLock(resolvedProfileDir);
  try {
    await assertNoExternalBrowserProcess(resolvedProfileDir);
    if (!(await exists(resolvedProfileDir))) {
      return { status: "missing", profileDir: resolvedProfileDir };
    }

    const backupDir = await uniqueBackupPath(resolvedProfileDir, now);
    await fs.rename(resolvedProfileDir, backupDir);
    return {
      status: "moved",
      profileDir: resolvedProfileDir,
      backupDir,
    };
  } finally {
    await release();
  }
}
