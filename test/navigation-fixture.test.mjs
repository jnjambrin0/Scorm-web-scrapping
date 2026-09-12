import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chromium } from "playwright";

import { openCourseOutline } from "../scripts/backend/scorm/navigation.mjs";

const barePath = "/ultra/courses/_14390_1/scorm/overview/_689299_1";
const outlinePath = "/ultra/courses/_14390_1/outline/scorm/overview/_689299_1";

async function withFixture(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previousUrl = process.env.COURSE_OUTLINE_URL;
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${barePath}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    await run({ port, browser });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousUrl === undefined) delete process.env.COURSE_OUTLINE_URL;
    else process.env.COURSE_OUTLINE_URL = previousUrl;
  }
}

test("requests the reported direct URL once and never synthesizes outline after a 404", async () => {
  const requests = [];
  await withFixture((request, response) => {
    if (request.url !== "/favicon.ico") requests.push(request.url || "");
    response.writeHead(404, { "content-type": "text/html" });
    response.end("Not found");
  }, async ({ browser }) => {
    const page = await browser.newPage();
    await assert.rejects(
      () => openCourseOutline(page),
      /Direct SCORM source returned HTTP 404/,
    );
  });

  assert.deepEqual(requests, [barePath]);
});

test("accepts a same-item HTTP redirect returned by Blackboard", async () => {
  const requests = [];
  await withFixture((request, response) => {
    if (request.url !== "/favicon.ico") requests.push(request.url || "");
    if (request.url === barePath) {
      response.writeHead(302, { location: `${outlinePath}?courseId=_14390_1` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<p>Iniciar intento</p>");
  }, async ({ browser, port }) => {
    const page = await browser.newPage();
    await openCourseOutline(page);
    assert.equal(page.url(), `http://127.0.0.1:${port}${outlinePath}?courseId=_14390_1`);
  });

  assert.deepEqual(requests, [barePath, `${outlinePath}?courseId=_14390_1`]);
});

test("clicks the exact outline link rendered by a Stream landing page", async () => {
  const requests = [];
  await withFixture((request, response) => {
    if (request.url !== "/favicon.ico") requests.push(request.url || "");
    if (request.url === barePath) {
      response.writeHead(302, { location: "/ultra/stream" });
      response.end();
      return;
    }
    if (request.url === "/ultra/stream") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<a href="${outlinePath}?courseId=_14390_1">SCORM</a>`);
      return;
    }
    response.writeHead(500);
    response.end("An alternate route was incorrectly requested");
  }, async ({ browser }) => {
    const page = await browser.newPage();
    await openCourseOutline(page);
  });

  assert.deepEqual(requests, [
    barePath,
    "/ultra/stream",
    barePath,
    "/ultra/stream",
    `${outlinePath}?courseId=_14390_1`,
  ]);
});

test("fails closed when a Stream landing page has no matching SCORM link", async () => {
  await withFixture((request, response) => {
    if (request.url === barePath) {
      response.writeHead(302, { location: "/ultra/stream" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<a href='/ultra/courses/_14390_1/outline/scorm/overview/_other_1'>Other</a>");
  }, async ({ browser }) => {
    const page = await browser.newPage();
    await assert.rejects(
      () => openCourseOutline(page),
      /Direct SCORM source did not render a matching SCORM link/,
    );
  });
});

test("fails closed when a Stream landing page has ambiguous matching links", async () => {
  await withFixture((request, response) => {
    if (request.url === barePath) {
      response.writeHead(302, { location: "/ultra/stream" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <a href="${outlinePath}?courseId=_14390_1">One</a>
      <a href="/ultra/courses/_14390_1/grades/scorm/overview/_689299_1?courseId=_14390_1">Two</a>
    `);
  }, async ({ browser }) => {
    const page = await browser.newPage();
    await assert.rejects(
      () => openCourseOutline(page),
      /Direct SCORM source rendered multiple matching SCORM links/,
    );
  });
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
