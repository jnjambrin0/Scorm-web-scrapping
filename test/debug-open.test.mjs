import test from "node:test";
import assert from "node:assert/strict";

import { openScormForDebug } from "../scripts/backend/scorm/debug-open.mjs";

function fakePage(url, title) {
  return {
    frames: () => [],
    locator: () => ({ innerText: async () => "debug text" }),
    screenshot: async () => {},
    title: async () => title,
    url: () => url,
  };
}

test("debug flow uses the production openScorm navigation", async () => {
  const page = fakePage("https://example.test/scormdriver/indexAPI.html", "SCORM");
  let openedWith = null;
  let closed = false;
  const context = {
    close: async () => {
      closed = true;
    },
    pages: () => [page],
  };
  const logs = [];

  const report = await openScormForDebug({
    artifactDir: "/tmp/scorm-debug-test",
    fsApi: { mkdir: async () => {} },
    launchContext: async () => context,
    logger: (value) => logs.push(value),
    openScormPage: async (receivedContext) => {
      openedWith = receivedContext;
      return page;
    },
  });

  assert.equal(openedWith, context);
  assert.equal(closed, true);
  assert.equal(report.scormPageIndex, 0);
  assert.equal(report.summaries[0].url, page.url());
  assert.equal(logs.length, 1);
});
