import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { waitForAuthenticationOutcome } from "../scripts/backend/browser/session.mjs";

const baseUrl = "https://u-tad.blackboard.com/ultra/stream";

class FakePage extends EventEmitter {
  constructor({ url, title, body, password = false }) {
    super();
    this.currentUrl = url;
    this.currentTitle = title;
    this.currentBody = body;
    this.password = password;
  }

  url() {
    return this.currentUrl;
  }

  mainFrame() {
    return this;
  }

  async title() {
    return this.currentTitle;
  }

  locator(selector) {
    if (selector === "body") {
      return { innerText: async () => this.currentBody };
    }
    return { count: async () => (this.password ? 1 : 0) };
  }

  navigate({ url, title, body, password = false }) {
    this.currentUrl = url;
    this.currentTitle = title;
    this.currentBody = body;
    this.password = password;
    this.emit("framenavigated", this);
    this.emit("load");
  }
}

class FakeContext extends EventEmitter {
  constructor(pages) {
    super();
    this.openPages = pages;
  }

  pages() {
    return this.openPages;
  }
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("interactive authentication resolves when Blackboard is observed", async () => {
  const page = new FakePage({
    url: "https://login.microsoftonline.com/common/oauth2/authorize",
    title: "Sign in",
    body: "Enter your password",
    password: true,
  });
  const context = new FakeContext([page]);
  const pending = waitForAuthenticationOutcome(context, { baseUrl, emptyGraceMs: 10 });

  await delay();
  page.navigate({
    url: baseUrl,
    title: "Courses",
    body: "Course Content",
  });

  assert.deepEqual(await pending, {
    outcome: "verified",
    destination: "blackboard",
    finalUrl: "https://u-tad.blackboard.com/ultra/stream",
  });
});

test("interactive authentication reports an intentional close before Blackboard", async () => {
  const page = new FakePage({
    url: "https://login.microsoftonline.com/common/oauth2/authorize",
    title: "Sign in",
    body: "Enter your password",
    password: true,
  });
  const context = new FakeContext([page]);
  const pending = waitForAuthenticationOutcome(context, { baseUrl, emptyGraceMs: 10 });

  context.openPages = [];
  page.emit("close");

  const result = await pending;
  assert.equal(result.outcome, "closed-before-verification");
  assert.equal(result.destination, "login");
});

test("interactive authentication detects windowless page removal without a close event", async () => {
  const page = new FakePage({
    url: "https://login.microsoftonline.com/common/oauth2/authorize",
    title: "Sign in",
    body: "Enter your password",
    password: true,
  });
  const context = new FakeContext([page]);
  const pending = waitForAuthenticationOutcome(context, {
    baseUrl,
    emptyGraceMs: 5,
    emptyPollMs: 5,
  });

  await delay();
  context.openPages = [];

  const result = await pending;
  assert.equal(result.outcome, "closed-before-verification");
  assert.equal(result.destination, "login");
});

test("interactive authentication follows a Blackboard popup", async () => {
  const loginPage = new FakePage({
    url: "https://login.microsoftonline.com/common/oauth2/authorize",
    title: "Sign in",
    body: "Enter your password",
    password: true,
  });
  const context = new FakeContext([loginPage]);
  const pending = waitForAuthenticationOutcome(context, { baseUrl, emptyGraceMs: 10 });
  const popup = new FakePage({ url: "about:blank", title: "", body: "" });

  context.openPages = [loginPage, popup];
  context.emit("page", popup);
  popup.navigate({ url: baseUrl, title: "Courses", body: "Course Content" });

  const result = await pending;
  assert.equal(result.outcome, "verified");
  assert.equal(result.destination, "blackboard");
});
