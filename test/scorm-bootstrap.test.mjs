import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chromium } from "playwright";

import { openScorm, scormNavigationMetadata } from "../scripts/backend/scorm/navigation.mjs";

const barePath = "/ultra/courses/_14390_1/scorm/overview/_689299_1";
const outlinePath = "/ultra/courses/_14390_1/outline/scorm/overview/_689299_1";

test("bootstraps Blackboard in the initial page before resolving the exact SCORM source", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url !== "/favicon.ico") requests.push(request.url || "");
    if (request.url === "/ultra/stream" && !request.headers.cookie?.includes("bb-ready=1")) {
      response.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": "bb-ready=1; Path=/",
      });
      response.end("<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === "/ultra/stream") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<a href="${outlinePath}?courseId=_14390_1">SCORM</a>`);
      return;
    }
    if (request.url === barePath) {
      response.writeHead(302, { location: "/ultra/stream" });
      response.end();
      return;
    }
    if (request.url?.startsWith(`${outlinePath}?courseId=_14390_1`)) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<button onclick="window.open(\'/scormdriver/indexAPI.html\', \'_blank\')">Start attempt</button>',
      );
      return;
    }
    if (request.url === "/scormdriver/indexAPI.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("SCORM player");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const previousUrl = process.env.COURSE_OUTLINE_URL;
  const previousBaseUrl = process.env.BLACKBOARD_BASE_URL;
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${barePath}`;
  process.env.BLACKBOARD_BASE_URL = `http://127.0.0.1:${port}/ultra/stream`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    const context = await browser.newContext();
    const initialPage = await context.newPage();
    const scormPage = await openScorm(context);
    const metadata = scormNavigationMetadata(scormPage);

    assert.equal(context.pages().length, 2, "must reuse the initial page before opening SCORM popup");
    assert.ok(context.pages().includes(initialPage));
    assert.equal(scormPage.url(), `http://127.0.0.1:${port}/scormdriver/indexAPI.html`);
    assert.deepEqual(metadata, {
      bootstrap: { resolvedUrl: `http://127.0.0.1:${port}/ultra/stream` },
      source: {
        sourceUrl: `http://127.0.0.1:${port}${barePath}`,
        resolvedUrl: `http://127.0.0.1:${port}${outlinePath}`,
        attempts: 2,
        resolution: "dom-link",
      },
      attempt: {
        bridgeSeen: false,
        playerRole: "legacy-player",
        playerUrl: `http://127.0.0.1:${port}/scormdriver/indexAPI.html`,
        hostUrl: `http://127.0.0.1:${port}/scormdriver/indexAPI.html`,
        relation: "popup",
        surface: "top-level",
        unrelatedPageCount: 0,
      },
    });
    assert.deepEqual(requests, [
      "/ultra/stream",
      barePath,
      "/ultra/stream",
      barePath,
      "/ultra/stream",
      `${outlinePath}?courseId=_14390_1`,
      "/scormdriver/indexAPI.html",
    ]);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousUrl === undefined) delete process.env.COURSE_OUTLINE_URL;
    else process.env.COURSE_OUTLINE_URL = previousUrl;
    if (previousBaseUrl === undefined) delete process.env.BLACKBOARD_BASE_URL;
    else process.env.BLACKBOARD_BASE_URL = previousBaseUrl;
  }
});
