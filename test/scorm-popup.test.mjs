import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chromium } from "playwright";

import { openScorm } from "../scripts/backend/scorm/navigation.mjs";

const scormPath =
  "/ultra/courses/_14330_1/outline/scorm/overview/_641800_1";

test("follows the SCORM popup opened by Start attempt", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/ultra/stream") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath || request.url?.startsWith(`${scormPath}?`)) {
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
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${scormPath}`;
  process.env.BLACKBOARD_BASE_URL = `http://127.0.0.1:${port}/ultra/stream`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    const context = await browser.newContext();
    const page = await openScorm(context);
    assert.equal(page.url(), `http://127.0.0.1:${port}/scormdriver/indexAPI.html`);
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

test("uses the current page when Start attempt does not open a popup", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/ultra/stream") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath || request.url?.startsWith(`${scormPath}?`)) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<button onclick="location.href=\'/scormdriver/indexAPI.html\'">Start attempt</button>',
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
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${scormPath}`;
  process.env.BLACKBOARD_BASE_URL = `http://127.0.0.1:${port}/ultra/stream`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    const context = await browser.newContext();
    const page = await openScorm(context);
    assert.equal(page.url(), `http://127.0.0.1:${port}/scormdriver/indexAPI.html`);
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
