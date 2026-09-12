import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chromium } from "playwright";

import { openCourseOutline } from "../scripts/backend/scorm/navigation.mjs";

test("resolves a bare SCORM URL through the stream to the canonical item link", async () => {
  const canonicalPath =
    "/ultra/courses/_14330_1/outline/scorm/overview/_641800_1";
  const linkedPath =
    "/ultra/courses/_14330_1/grades/scorm/overview/_641800_1";
  const barePath =
    "/ultra/courses/_14330_1/scorm/overview/_641800_1";
  const requestedPaths = [];
  const server = http.createServer((request, response) => {
    requestedPaths.push(request.url || "");
    if (request.url === barePath) {
      response.writeHead(302, { location: "/ultra/stream" });
      response.end();
      return;
    }
    if (request.url?.startsWith(`${canonicalPath}?`)) {
      response.writeHead(500, { "content-type": "text/html" });
      response.end("The generated outline route must not be visited first.");
      return;
    }
    if (request.url?.startsWith(`${linkedPath}?`)) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>Iniciar intento</p>");
      return;
    }
    if (request.url === "/ultra/stream") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<a href="${linkedPath}?courseId=_14330_1">SCORM</a>`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previousUrl = process.env.COURSE_OUTLINE_URL;
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${barePath}`;

  let browser = null;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    await openCourseOutline(page);
    assert.equal(page.url(), `http://127.0.0.1:${port}${linkedPath}?courseId=_14330_1`);
    assert.equal(
      requestedPaths.some((requestPath) => requestPath.startsWith(canonicalPath)),
      false,
      "the actual course link must be followed before synthesized route fallbacks",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousUrl === undefined) delete process.env.COURSE_OUTLINE_URL;
    else process.env.COURSE_OUTLINE_URL = previousUrl;
  }
});

test("does not treat a login page served at the SCORM URL as authenticated", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/ultra/courses/_14330_1/scorm/overview/_641800_1") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Sign in</title><p>Sign in</p><input type=password>");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const previousUrl = process.env.COURSE_OUTLINE_URL;
  process.env.COURSE_OUTLINE_URL =
    `http://127.0.0.1:${port}/ultra/courses/_14330_1/scorm/overview/_641800_1`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    const page = await browser.newPage();
    await assert.rejects(
      () => openCourseOutline(page),
      /Blackboard session expired or login is required/,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousUrl === undefined) delete process.env.COURSE_OUTLINE_URL;
    else process.env.COURSE_OUTLINE_URL = previousUrl;
  }
});
