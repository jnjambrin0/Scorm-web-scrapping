import { chromium } from "playwright";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { browserProfileDir } from "../shared/paths.mjs";

const execFileAsync = promisify(execFile);

export class BrowserProfileBusyError extends Error {
  constructor(profileDir) {
    super(
      `Browser profile is already in use: ${profileDir}. Close the other Blackboard browser window and try again.`,
    );
    this.name = "BrowserProfileBusyError";
    this.code = "BROWSER_PROFILE_BUSY";
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
    throw new BrowserProfileBusyError(path.resolve(profileDir));
  }
}

function profileLockPath(profileDir) {
  return `${path.resolve(profileDir)}.lock`;
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

export async function acquireBrowserProfileLock(profileDir) {
  const resolvedProfileDir = path.resolve(profileDir);
  const lockPath = profileLockPath(resolvedProfileDir);
  await fs.mkdir(path.dirname(resolvedProfileDir), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = `${process.pid}:${crypto.randomUUID()}`;
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

      const owner = await fs.readFile(lockPath, "utf8").catch(() => "");
      const ownerPid = Number(owner.split(":", 1)[0]);
      if (!owner.trim()) {
        throw new BrowserProfileBusyError(resolvedProfileDir);
      }
      if (processIsAlive(ownerPid)) {
        throw new BrowserProfileBusyError(resolvedProfileDir);
      }

      await fs.unlink(lockPath).catch(() => {});
    }
  }

  throw new BrowserProfileBusyError(resolvedProfileDir);
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

  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    try {
      return await originalClose(...args);
    } finally {
      await releaseProfileLock();
    }
  };
  context.on("close", () => {
    void releaseProfileLock();
  });

  return context;
}
