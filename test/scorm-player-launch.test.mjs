import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chromium } from "playwright";

import {
  openScorm,
  scormNavigationMetadata,
  waitForFrame,
} from "../scripts/backend/scorm/navigation.mjs";

const courseId = "_14390_1";
const itemId = "_701824_1";
const scormPath = `/ultra/courses/${courseId}/scorm/overview/${itemId}`;
const launchFramePath = `/ultra/courses/${courseId}/scorm/launchFrame`;
const modernPlayerPath =
  "/webapps/scor-scormengine-BB5d3210a6eb3d6/defaultui/player/modern.html";

function respondHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withBlackboardConfig(port, callback) {
  const previousUrl = process.env.COURSE_OUTLINE_URL;
  const previousBaseUrl = process.env.BLACKBOARD_BASE_URL;
  process.env.COURSE_OUTLINE_URL = `http://127.0.0.1:${port}${scormPath}`;
  process.env.BLACKBOARD_BASE_URL = `http://127.0.0.1:${port}/ultra/stream`;
  try {
    return await callback();
  } finally {
    if (previousUrl === undefined) delete process.env.COURSE_OUTLINE_URL;
    else process.env.COURSE_OUTLINE_URL = previousUrl;
    if (previousBaseUrl === undefined) delete process.env.BLACKBOARD_BASE_URL;
    else process.env.BLACKBOARD_BASE_URL = previousBaseUrl;
  }
}

function blackboardRoutes(request, response, playerHtml) {
  if (request.url === "/ultra/stream") {
    respondHtml(response, "<title>Courses</title><main>Course Content</main>");
    return true;
  }
  if (request.url === scormPath) {
    respondHtml(
      response,
      `<button onclick="window.open('${modernPlayerPath}', '_blank'); location.assign('${launchFramePath}')">Start attempt</button>`,
    );
    return true;
  }
  if (request.url === launchFramePath) {
    respondHtml(response, "<main>Blackboard SCORM launch frame</main>");
    return true;
  }
  if (request.url === modernPlayerPath) {
    respondHtml(response, playerHtml);
    return true;
  }
  return false;
}

test("follows Blackboard launchFrame into the Rustici modern player", async () => {
  await withServer((request, response) => {
    if (
      blackboardRoutes(
        request,
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/index.html"></iframe>',
      )
    ) {
      return;
    }
    if (request.url === "/scormcontent/rise/index.html") {
      respondHtml(response, "<main>Rise lesson</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 2000 });
        const metadata = scormNavigationMetadata(player);

        assert.equal(player.url(), `http://127.0.0.1:${port}${modernPlayerPath}`);
        assert.match(frame.url(), /\/scormcontent\/rise\/index\.html$/);
        assert.deepEqual(metadata?.attempt, {
          playerRole: "engine-player",
          playerUrl: `http://127.0.0.1:${port}${modernPlayerPath}`,
          hostUrl: `http://127.0.0.1:${port}${modernPlayerPath}`,
          relation: "popup",
          surface: "top-level",
          bridgeSeen: true,
          unrelatedPageCount: 0,
        });
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("follows a Rustici modern player embedded in Blackboard launchFrame", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === launchFramePath) {
      respondHtml(response, `<iframe src="${modernPlayerPath}"></iframe>`);
      return;
    }
    if (request.url === modernPlayerPath) {
      respondHtml(
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/inline.html"></iframe>',
      );
      return;
    }
    if (request.url === "/scormcontent/rise/inline.html") {
      respondHtml(response, "<main>Rise lesson in an inline player</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 2000 });

        assert.equal(player.url(), `http://127.0.0.1:${port}${launchFramePath}`);
        assert.match(frame.url(), /\/scormcontent\/rise\/inline\.html$/);
        assert.deepEqual(scormNavigationMetadata(player)?.attempt, {
          playerRole: "engine-player",
          playerUrl: `http://127.0.0.1:${port}${modernPlayerPath}`,
          hostUrl: `http://127.0.0.1:${port}${launchFramePath}`,
          relation: "source",
          surface: "inline-frame",
          bridgeSeen: true,
          unrelatedPageCount: 0,
        });
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("accepts a verified SCORM content frame embedded directly in launchFrame", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === launchFramePath) {
      respondHtml(
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/direct-frame.html"></iframe>',
      );
      return;
    }
    if (request.url === "/scormcontent/rise/direct-frame.html") {
      respondHtml(response, "<main>Rise lesson in a direct frame</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 2000 });

        assert.equal(player.url(), `http://127.0.0.1:${port}${launchFramePath}`);
        assert.match(frame.url(), /\/scormcontent\/rise\/direct-frame\.html$/);
        assert.equal(scormNavigationMetadata(player)?.attempt?.playerRole, "content-window");
        assert.equal(scormNavigationMetadata(player)?.attempt?.surface, "inline-frame");
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("keeps an inline player bound to its own content subtree", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === launchFramePath) {
      respondHtml(
        response,
        `<iframe src="${modernPlayerPath}"></iframe><iframe src="/scormcontent/rise/unrelated-sibling.html"></iframe>`,
      );
      return;
    }
    if (request.url === modernPlayerPath) {
      respondHtml(response, "<main>Player loading without content</main>");
      return;
    }
    if (request.url === "/scormcontent/rise/unrelated-sibling.html") {
      respondHtml(response, "<main>Unrelated Rise lesson</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        await assert.rejects(
          () => waitForFrame(player, { timeout: 250 }),
          /SCORM inline player was opened but its content surface did not become ready/,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("follows content opened from an inline player in a later window", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === launchFramePath) {
      respondHtml(response, `<iframe src="${modernPlayerPath}"></iframe>`);
      return;
    }
    if (request.url === modernPlayerPath) {
      respondHtml(
        response,
        '<script>setTimeout(() => window.open("/scormcontent/rise/inline-popup.html", "_blank"), 100)</script>',
      );
      return;
    }
    if (request.url === "/scormcontent/rise/inline-popup.html") {
      respondHtml(response, "<main>Rise lesson in an inline-player popup</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 2000 });

        assert.equal(
          frame.url(),
          `http://127.0.0.1:${port}/scormcontent/rise/inline-popup.html`,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("does not select a player frame that was already loaded before Start attempt", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<iframe src="${modernPlayerPath}" onload="document.querySelector('button').hidden = false"></iframe><button hidden onclick="window.open('${modernPlayerPath}', '_blank')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === modernPlayerPath) {
      respondHtml(
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/pre-existing.html"></iframe>',
      );
      return;
    }
    if (request.url === "/scormcontent/rise/pre-existing.html") {
      respondHtml(response, "<main>Rise lesson</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);

        assert.equal(player.url(), `http://127.0.0.1:${port}${modernPlayerPath}`);
        assert.equal(scormNavigationMetadata(player)?.attempt?.relation, "popup");
        assert.equal(scormNavigationMetadata(player)?.attempt?.surface, "top-level");
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("ignores an other-origin player-shaped frame inside launchFrame", async () => {
  await withServer((request, response) => {
    if (request.url === modernPlayerPath) {
      respondHtml(response, "<main>Untrusted player</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (untrustedPort) => {
    await withServer((request, response) => {
      if (request.url === "/ultra/stream") {
        respondHtml(response, "<title>Courses</title><main>Course Content</main>");
        return;
      }
      if (request.url === scormPath) {
        respondHtml(
          response,
          `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
        );
        return;
      }
      if (request.url === launchFramePath) {
        respondHtml(
          response,
          `<iframe src="http://127.0.0.1:${untrustedPort}${modernPlayerPath}"></iframe><iframe src="${modernPlayerPath}"></iframe>`,
        );
        return;
      }
      if (request.url === modernPlayerPath) {
        respondHtml(
          response,
          '<iframe name="scormdriver_content" src="/scormcontent/rise/trusted-inline.html"></iframe>',
        );
        return;
      }
      if (request.url === "/scormcontent/rise/trusted-inline.html") {
        respondHtml(response, "<main>Trusted Rise lesson</main>");
        return;
      }
      response.writeHead(404);
      response.end();
    }, async (port) => {
      await withBlackboardConfig(port, async () => {
        const browser = await chromium.launch({ channel: "chrome", headless: true });
        try {
          const context = await browser.newContext();
          const player = await openScorm(context);
          const frame = await waitForFrame(player, { timeout: 2000 });

          assert.equal(player.url(), `http://127.0.0.1:${port}${launchFramePath}`);
          assert.match(frame.url(), /trusted-inline\.html$/);
          assert.equal(scormNavigationMetadata(player)?.attempt?.playerUrl, `http://127.0.0.1:${port}${modernPlayerPath}`);
          await context.close();
        } finally {
          await browser.close();
        }
      });
    });
  });
});

test("waits for SCORM content opened in a third window", async () => {
  await withServer((request, response) => {
    if (
      blackboardRoutes(
        request,
        response,
        "<script>setTimeout(() => window.open('/scormcontent/rise/third-window.html', '_blank'), 150)</script>",
      )
    ) {
      return;
    }
    if (request.url === "/scormcontent/rise/third-window.html") {
      respondHtml(response, "<main>Rise lesson in a SCO window</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 3000 });

        assert.equal(player.url(), `http://127.0.0.1:${port}${modernPlayerPath}`);
        assert.equal(
          frame.url(),
          `http://127.0.0.1:${port}/scormcontent/rise/third-window.html`,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("keeps support for an in-place legacy indexAPI player", async () => {
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        '<button onclick="location.href=\'/scormdriver/indexAPI.html\'">Start attempt</button>',
      );
      return;
    }
    if (request.url === "/scormdriver/indexAPI.html") {
      respondHtml(
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/legacy.html"></iframe>',
      );
      return;
    }
    if (request.url === "/scormcontent/rise/legacy.html") {
      respondHtml(response, "<main>Legacy Rise lesson</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        const player = await openScorm(context);
        const frame = await waitForFrame(player, { timeout: 2000 });

        assert.equal(player.url(), `http://127.0.0.1:${port}/scormdriver/indexAPI.html`);
        assert.match(frame.url(), /\/scormcontent\/rise\/legacy\.html$/);
        assert.equal(scormNavigationMetadata(player)?.attempt?.relation, "source");
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("does not select a pre-existing player page over the attempt popup", async () => {
  await withServer((request, response) => {
    if (
      blackboardRoutes(
        request,
        response,
        '<iframe name="scormdriver_content" src="/scormcontent/rise/index.html"></iframe>',
      )
    ) {
      return;
    }
    if (request.url === "/scormcontent/rise/index.html") {
      respondHtml(response, "<main>Rise lesson</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        await context.newPage();
        const existingPlayer = await context.newPage();
        await existingPlayer.goto(`http://127.0.0.1:${port}${modernPlayerPath}`);

        const player = await openScorm(context);

        assert.notEqual(player, existingPlayer);
        assert.equal(player.url(), `http://127.0.0.1:${port}${modernPlayerPath}`);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("ignores an other-origin player-shaped popup from the same attempt", async () => {
  await withServer((request, response) => {
    if (request.url === modernPlayerPath) {
      respondHtml(response, "<main>Untrusted player</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (untrustedPort) => {
    await withServer((request, response) => {
      if (request.url === "/ultra/stream") {
        respondHtml(response, "<title>Courses</title><main>Course Content</main>");
        return;
      }
      if (request.url === scormPath) {
        respondHtml(
          response,
          `<button onclick="window.open('http://127.0.0.1:${untrustedPort}${modernPlayerPath}', '_blank'); window.open('${modernPlayerPath}', '_blank'); location.assign('${launchFramePath}')">Start attempt</button>`,
        );
        return;
      }
      if (request.url === launchFramePath) {
        respondHtml(response, "<main>Blackboard SCORM launch frame</main>");
        return;
      }
      if (request.url === modernPlayerPath) {
        respondHtml(
          response,
          '<iframe name="scormdriver_content" src="/scormcontent/rise/index.html"></iframe>',
        );
        return;
      }
      if (request.url === "/scormcontent/rise/index.html") {
        respondHtml(response, "<main>Rise lesson</main>");
        return;
      }
      response.writeHead(404);
      response.end();
    }, async (port) => {
      await withBlackboardConfig(port, async () => {
        const browser = await chromium.launch({ channel: "chrome", headless: true });
        try {
          const context = await browser.newContext();
          const player = await openScorm(context);

          assert.equal(player.url(), `http://127.0.0.1:${port}${modernPlayerPath}`);
          await context.close();
        } finally {
          await browser.close();
        }
      });
    });
  });
});

test("fails closed when one attempt opens multiple eligible players", async () => {
  const secondPlayerPath =
    "/webapps/scor-scormengine-second/defaultui/player/modern.html";
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="window.open('${modernPlayerPath}', '_blank'); window.open('${secondPlayerPath}', '_blank')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === modernPlayerPath || request.url === secondPlayerPath) {
      respondHtml(response, "<main>SCORM player</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        await assert.rejects(
          () => openScorm(context),
          /SCORM attempt exposed multiple eligible player surfaces/,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});

test("fails closed when launchFrame embeds multiple eligible players", async () => {
  const secondPlayerPath =
    "/webapps/scor-scormengine-second/defaultui/player/modern.html";
  await withServer((request, response) => {
    if (request.url === "/ultra/stream") {
      respondHtml(response, "<title>Courses</title><main>Course Content</main>");
      return;
    }
    if (request.url === scormPath) {
      respondHtml(
        response,
        `<button onclick="location.assign('${launchFramePath}')">Start attempt</button>`,
      );
      return;
    }
    if (request.url === launchFramePath) {
      respondHtml(
        response,
        `<iframe src="${modernPlayerPath}"></iframe><iframe src="${secondPlayerPath}"></iframe>`,
      );
      return;
    }
    if (request.url === modernPlayerPath || request.url === secondPlayerPath) {
      respondHtml(response, "<main>SCORM player</main>");
      return;
    }
    response.writeHead(404);
    response.end();
  }, async (port) => {
    await withBlackboardConfig(port, async () => {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext();
        await assert.rejects(
          () => openScorm(context),
          /SCORM attempt exposed multiple eligible player surfaces/,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});
