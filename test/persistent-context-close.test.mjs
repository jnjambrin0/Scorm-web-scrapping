import test from "node:test";
import assert from "node:assert/strict";

import { managePersistentContextClose } from "../scripts/backend/browser/context.mjs";

test("keeps the profile lock until the persistent browser has closed", async () => {
  const order = [];
  const browser = {
    isConnected: () => true,
    async close() {
      order.push("browser");
    },
  };
  const context = {
    browser: () => browser,
    async close() {
      order.push("context");
    },
  };
  const release = async () => {
    order.push("release");
  };

  managePersistentContextClose(context, release);
  await Promise.all([context.close(), context.close()]);

  assert.deepEqual(order, ["context", "browser", "release"]);
});

test("releases the lock when Chromium has already disconnected", async () => {
  const order = [];
  const context = {
    browser: () => ({ isConnected: () => false }),
    async close() {
      order.push("context");
    },
  };

  managePersistentContextClose(context, async () => {
    order.push("release");
  });
  await context.close();

  assert.deepEqual(order, ["context", "release"]);
});
