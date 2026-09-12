import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadSessionVerificationModule() {
  const sourcePath = path.resolve("src/lib/session-verification.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("persists only a valid, non-secret Blackboard verification snapshot", async () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  globalThis.window = { localStorage };

  try {
    const verification = await loadSessionVerificationModule();
    const snapshot = verification.saveSessionVerification(new Date("2026-09-12T10:00:00.000Z"));

    assert.deepEqual(snapshot, {
      verified: true,
      checkedAt: "2026-09-12T10:00:00.000Z",
      destination: "blackboard",
    });
    assert.deepEqual(verification.loadSessionVerification(), snapshot);
    assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(verification.SESSION_VERIFICATION_STORAGE_KEY))).sort(), [
      "checkedAt",
      "destination",
      "verified",
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("rejects corrupted snapshots and clears the verification after login is required", async () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  globalThis.window = { localStorage };

  try {
    const verification = await loadSessionVerificationModule();
    localStorage.setItem(verification.SESSION_VERIFICATION_STORAGE_KEY, "not-json");
    assert.equal(verification.loadSessionVerification(), null);

    verification.saveSessionVerification(new Date("2026-09-12T10:00:00.000Z"));
    verification.clearSessionVerification();
    assert.equal(verification.loadSessionVerification(), null);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("starts exactly one automatic remote check only when no browser job is active", async () => {
  const verification = await loadSessionVerificationModule();
  const ready = {
    alreadyFired: false,
    bootstrapReady: true,
    jobBootstrapped: true,
    sessionBootstrapped: true,
    jobRunning: false,
    sessionBusy: false,
    hasBlackboardBaseUrl: true,
  };

  assert.equal(verification.shouldStartAutomaticSessionCheck(ready), true);
  assert.equal(
    verification.shouldStartAutomaticSessionCheck({ ...ready, alreadyFired: true }),
    false,
  );
  assert.equal(
    verification.shouldStartAutomaticSessionCheck({ ...ready, jobRunning: true }),
    false,
  );
  assert.equal(
    verification.shouldStartAutomaticSessionCheck({ ...ready, sessionBusy: true }),
    false,
  );
});
