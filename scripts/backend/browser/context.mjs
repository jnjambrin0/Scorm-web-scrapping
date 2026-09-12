import { chromium } from "playwright";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { browserProfileDir } from "../shared/paths.mjs";

const execFileAsync = promisify(execFile);
const LOCK_METADATA_GRACE_MS = 50;

export class BrowserProfileBusyError extends Error {
  constructor(profileDir, { reason = "application-lock", owner = null } = {}) {
    super(
      reason === "external-browser"
        ? `Browser profile is open in an external browser: ${profileDir}. Close that Blackboard browser window and try again.`
        : `Browser profile is already in use: ${profileDir}. Wait for the active Blackboard task or close the other Blackboard browser window and try again.`,
    );
    this.name = "BrowserProfileBusyError";
    this.code = "BROWSER_PROFILE_BUSY";
    this.reason = reason;
    this.owner = owner;
  }
}

export function isBrowserProfileConflict(error) {
  const message = error?.message || String(error || "");
  return /SingletonLock|user data directory.*(?:in use|already)|profile.*(?:in use|locked)|already.*(?:running|open)/i.test(
    message,
  );
}

export function externalBrowserPids(profileDir, psOutput, currentPid = process.pid) {
  const needle = path.resolve(profileDir);
  return String(psOutput || "")
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(
      (match) =>
        match &&
        Number(match[1]) !== currentPid &&
        match[2].includes(needle) &&
        /(?:chrome|chromium)/i.test(match[2]),
    )
    .map((match) => Number(match[1]));
}

export async function assertNoExternalBrowserProcess(profileDir) {
  if (process.platform === "win32") return;

  let result;
  try {
    result = await execFileAsync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
    });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (externalBrowserPids(profileDir, result.stdout).length > 0) {
    throw new BrowserProfileBusyError(path.resolve(profileDir), {
      reason: "external-browser",
    });
  }
}

export async function inspectBrowserProfileUsage(profileDir = browserProfileDir()) {
  try {
    await assertNoExternalBrowserProcess(profileDir);
  } catch (error) {
    if (error instanceof BrowserProfileBusyError) {
      return { state: "external-browser" };
    }
    throw error;
  }
  const lock = await readBrowserProfileLock(profileDir);
  if (lock && processIsAlive(lock.pid)) {
    return { state: "application-lock", owner: publicLockOwner(lock) };
  }
  if (lock) {
    return { state: "stale-lock", owner: publicLockOwner(lock) };
  }
  return { state: "available" };
}

function profileLockPath(profileDir) {
  return `${path.resolve(profileDir)}.lock`;
}

function sanitizeLockOwner(value) {
  if (!value || typeof value !== "object") return null;
  const pid = Number(value.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return {
    pid,
    nonce: typeof value.nonce === "string" ? value.nonce : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    command: typeof value.command === "string" ? value.command : null,
    jobId: typeof value.jobId === "string" ? value.jobId : null,
  };
}

function publicLockOwner(owner) {
  return {
    pid: owner.pid,
    createdAt: owner.createdAt,
    command: owner.command,
    jobId: owner.jobId,
  };
}

export function parseBrowserProfileLock(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return sanitizeLockOwner(JSON.parse(value));
  } catch {
    const pid = Number(value.split(":", 1)[0]);
    return Number.isInteger(pid) && pid > 0
      ? { pid, nonce: null, createdAt: null, command: null, jobId: null }
      : null;
  }
}

export async function readBrowserProfileLock(profileDir) {
  const lockPath = profileLockPath(profileDir);
  const value = await fs.readFile(lockPath, "utf8").catch(() => null);
  return value === null ? null : parseBrowserProfileLock(value);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireBrowserProfileLock(profileDir, metadata = {}) {
  const resolvedProfileDir = path.resolve(profileDir);
  const lockPath = profileLockPath(resolvedProfileDir);
  await fs.mkdir(path.dirname(resolvedProfileDir), { recursive: true });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const owner = {
      pid: process.pid,
      nonce: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      command: metadata.command || process.env.SCORM_PROFILE_COMMAND || null,
      jobId: metadata.jobId || process.env.SCORM_PROFILE_JOB_ID || null,
    };
    const token = JSON.stringify(owner);
    let handle = null;
    try {
      handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(token, "utf8");
        await handle.close();
        handle = null;
      } catch (writeError) {
        await handle.close().catch(() => {});
        handle = null;
        await fs.unlink(lockPath).catch(() => {});
        throw writeError;
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const currentToken = await fs.readFile(lockPath, "utf8").catch(() => null);
        if (currentToken === token) {
          await fs.unlink(lockPath).catch(() => {});
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existing = await readBrowserProfileLock(resolvedProfileDir);
      if (!existing) {
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, LOCK_METADATA_GRACE_MS));
          continue;
        }
        throw new BrowserProfileBusyError(resolvedProfileDir);
      }
      if (processIsAlive(existing.pid)) {
        throw new BrowserProfileBusyError(resolvedProfileDir, {
          reason: "application-lock",
          owner: existing,
        });
      }

      await fs.unlink(lockPath).catch(() => {});
    }
  }

  throw new BrowserProfileBusyError(resolvedProfileDir);
}

export function managePersistentContextClose(context, releaseProfileLock) {
  const originalClose = context.close.bind(context);
  const browser = context.browser();
  let closePromise = null;
  context.close = async (...args) => {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      try {
        await originalClose(...args);
      } finally {
        try {
          if (browser?.isConnected()) {
            await browser.close();
          }
        } finally {
          await releaseProfileLock();
        }
      }
    })();
    return closePromise;
  };
  return context;
}

export async function launchPersistentContext(options = {}) {
  const {
    headless = false,
    profileDir = browserProfileDir(),
    viewport = { width: 1440, height: 1000 },
    acceptDownloads = true,
  } = options;
  const releaseProfileLock = await acquireBrowserProfileLock(profileDir);
  const baseOptions = {
    headless,
    viewport,
    acceptDownloads,
  };

  const preferredChannel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  let context;
  try {
    await assertNoExternalBrowserProcess(profileDir);
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        ...baseOptions,
        channel: preferredChannel,
      });
    } catch (error) {
      if (isBrowserProfileConflict(error)) {
        throw new BrowserProfileBusyError(path.resolve(profileDir));
      }
      if (process.env.PLAYWRIGHT_CHANNEL) {
        throw error;
      }

      console.warn(
        `Could not launch Chrome channel, falling back to bundled Chromium: ${error.message}`,
      );
      context = await chromium.launchPersistentContext(profileDir, baseOptions);
    }
  } catch (error) {
    await releaseProfileLock();
    throw error;
  }

  return managePersistentContextClose(context, releaseProfileLock);
}
