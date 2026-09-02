import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { waitUntilUserCloses } from "../scripts/backend/browser/session.mjs";

class FakePage extends EventEmitter {
  constructor(url = "about:blank") {
    super();
    this.currentUrl = url;
  }

  url() {
    return this.currentUrl;
  }

  mainFrame() {
    return this;
  }
}

class FakeContext extends EventEmitter {
  constructor(pages) {
    super();
    this.openPages = pages;
    this.closed = false;
  }

  pages() {
    return this.openPages;
  }

  isClosed() {
    return this.closed;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.openPages = [];
    this.emit("close");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("does not close while the password page remains open", async () => {
  const page = new FakePage("https://login.microsoftonline.com/password");
  const context = new FakeContext([page]);
  const pending = waitUntilUserCloses(context, { emptyGraceMs: 20 });

  await delay(45);
  assert.equal(context.closed, false);

  context.openPages = [];
  page.emit("close");
  const result = await pending;
  assert.equal(result.reason, "all-pages-closed");
});

test("does not close during a short popup handoff gap", async () => {
  const firstPage = new FakePage("https://u-tad.blackboard.com/ultra/stream");
  const secondPage = new FakePage("about:blank");
  const context = new FakeContext([firstPage]);
  const pending = waitUntilUserCloses(context, { emptyGraceMs: 35 });

  context.openPages = [];
  firstPage.emit("close");
  await delay(10);
  context.openPages = [secondPage];
  context.emit("page", secondPage);
  await delay(55);
  assert.equal(context.closed, false);

  context.openPages = [];
  secondPage.emit("close");
  const result = await pending;
  assert.equal(result.reason, "all-pages-closed");
});
