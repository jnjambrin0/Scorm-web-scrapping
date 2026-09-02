import { launchPersistentContext } from "./context.mjs";
import {
  classifySessionDestination,
  inspectProfileCookies,
  safePageUrl,
} from "./session-state.mjs";
import { configuredBlackboardBaseUrl } from "../shared/env.mjs";
import { browserProfileDir } from "../shared/paths.mjs";

const EMPTY_CONTEXT_GRACE_MS = 3000;

function requireBlackboardBaseUrl() {
  const url = configuredBlackboardBaseUrl();
  if (!url) {
    throw new Error(
      "BLACKBOARD_BASE_URL is not set. Add it to your .env (e.g. https://<your-institution>.blackboard.com/ultra/stream) and try again.",
    );
  }
  return url;
}

export async function openBlackboard({ mode }) {
  const baseUrl = requireBlackboardBaseUrl();
  const context = await launchPersistentContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());

  const state = {
    observing: false,
    lastDestination: "unknown",
    lastUrl: "about:blank",
    pageDestinations: new Map(),
  };
  const observeNavigation = async (candidatePage) => {
    if (!state.observing) return;
    let currentUrl;
    try {
      currentUrl = candidatePage.url();
    } catch {
      return;
    }
    if (currentUrl === "about:blank") return;
    const title = await candidatePage.title().catch(() => "");
    const bodyText = await candidatePage
      .locator("body")
      .innerText({ timeout: 2500 })
      .catch(() => "");
    const hasPasswordField =
      (await candidatePage.locator('input[type="password"]').count().catch(() => 0)) > 0;
    const destination = classifySessionDestination({
      currentUrl,
      baseUrl,
      title,
      bodyText: bodyText.slice(0, 1500),
      hasPasswordField,
    });
    state.lastDestination = destination;
    state.lastUrl = currentUrl;
    state.pageDestinations.set(candidatePage, destination);
    console.log(
      `Navigation: ${destination}; URL: ${safePageUrl(currentUrl)}.`,
    );
  };

  console.log(`Profile dir: ${browserProfileDir()}`);
  console.log(`Mode: ${mode}`);
  console.log("");
  if (mode === "login") {
    console.log("Login browser opened. There is no time limit for entering credentials.");
    console.log("Complete Blackboard login manually, then close the browser window.");
  } else {
    console.log("Using the saved browser profile. Close the window when done.");
  }

  try {
    const closePromise = waitUntilUserCloses(context, {
      onNavigate: observeNavigation,
      onPageClosed: () => {
        console.log(`Page closed; remaining pages: ${context.pages().length}.`);
      },
    });
    state.observing = true;
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throw new Error(
        `Could not open Blackboard at ${safePageUrl(baseUrl)}: ${error.message}`,
      );
    }
    await observeNavigation(page);

    console.log(`Current URL: ${safePageUrl(page.url())}`);
    const closeResult = await closePromise;
    console.log(`Browser closed: ${closeResult.reason}.`);
    const reachedBlackboard = [...state.pageDestinations.values()].includes(
      "blackboard",
    );

    if (mode === "login" && !reachedBlackboard) {
      process.exitCode = 1;
      throw new Error(
        `Login window closed before reaching Blackboard. Last destination: ${
          state.lastDestination
        }; URL: ${safePageUrl(state.lastUrl)}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          kind: "login",
          reachedBlackboard,
          destination: state.lastDestination,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close().catch(() => {});
  }
}

// Wait until the user is done with the headed browser, robustly. We can't just
// listen for `context.on("close")` because on macOS Chromium keeps the
// underlying app process alive after the user closes its only window
// ("windowless app" UX), which means the persistent context never sees a
// close event and the spawned child hangs forever — leaving the
// "waiting for browser close" toast stuck in the UI. We also watch each
// page's `close` event and force-close the context once no pages remain.
export function waitUntilUserCloses(
  context,
  {
    emptyGraceMs = EMPTY_CONTEXT_GRACE_MS,
    onNavigate = () => {},
    onPageClosed = () => {},
  } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    let completionStarted = false;
    let emptyTimer = null;
    let requestedCloseReason = null;
    const trackedPages = new WeakSet();
    const pendingNavigationObservers = new Set();

    const finish = (reason) => {
      if (completionStarted) return;
      completionStarted = true;
      settled = true;
      if (emptyTimer) clearTimeout(emptyTimer);
      process.removeListener("SIGINT", handleSigint);
      context.removeListener("close", handleContextClose);
      context.removeListener("page", handleContextPage);
      Promise.allSettled(pendingNavigationObservers).then(() => {
        resolve({ reason });
      });
    };

    const handleContextClose = () => {
      finish(requestedCloseReason || "context-closed");
    };

    const scheduleEmptyCheck = () => {
      if (settled || context.isClosed?.()) return;
      if (context.pages().length > 0) {
        if (emptyTimer) clearTimeout(emptyTimer);
        emptyTimer = null;
        return;
      }

      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = setTimeout(async () => {
        emptyTimer = null;
        if (settled || context.pages().length > 0) return;
        requestedCloseReason = "all-pages-closed";
        await context.close().catch(() => {});
        finish(requestedCloseReason);
      }, emptyGraceMs);
    };

    const trackPage = (page) => {
      if (trackedPages.has(page)) return;
      trackedPages.add(page);

      const dispatchNavigation = () => {
        let result;
        try {
          result = onNavigate(page);
        } catch {
          return;
        }
        if (!result || typeof result.then !== "function") return;
        const pending = Promise.resolve(result).catch(() => {});
        pendingNavigationObservers.add(pending);
        pending.finally(() => pendingNavigationObservers.delete(pending));
      };

      page.on("framenavigated", (frame) => {
        try {
          if (frame === page.mainFrame()) dispatchNavigation();
        } catch {
          // The page can close while Playwright is delivering the event.
        }
      });
      page.on("load", dispatchNavigation);
      page.on("close", async () => {
        try {
          onPageClosed(page);
        } catch {
          // Diagnostics must never prevent the context from being closed.
        }
        scheduleEmptyCheck();
      });

      try {
        if (page.url() !== "about:blank") dispatchNavigation();
      } catch {
        // The page may already be gone when the listener is attached.
      }
    };

    const handleContextPage = (page) => {
      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = null;
      trackPage(page);
    };

    const handleSigint = async () => {
      requestedCloseReason = "signal";
      await context.close().catch(() => {});
      finish(requestedCloseReason);
    };

    context.on("close", handleContextClose);
    context.on("page", handleContextPage);
    for (const existing of context.pages()) trackPage(existing);
    process.once("SIGINT", handleSigint);
    scheduleEmptyCheck();
  });
}

export async function checkSession({ remote = false } = {}) {
  const baseUrl = requireBlackboardBaseUrl();
  const context = await launchPersistentContext({ headless: true });
  try {
    let destination = "not-checked";
    let finalUrl = null;

    if (remote) {
      const page = context.pages()[0] || (await context.newPage());
      page.setDefaultNavigationTimeout(30000);
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      } catch (error) {
        throw new Error(
          `Could not remotely verify Blackboard at ${safePageUrl(baseUrl)}: ${error.message}`,
        );
      }
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const title = await page.title().catch(() => "");
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: 2500 })
        .catch(() => "");
      const hasPasswordField =
        (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
      finalUrl = page.url();
      destination = classifySessionDestination({
        currentUrl: finalUrl,
        baseUrl,
        title,
        bodyText: bodyText.slice(0, 1500),
        hasPasswordField,
      });
    }

    const cookies = await context.cookies(baseUrl);
    const profile = inspectProfileCookies(cookies);
    const verified = remote && destination === "blackboard";
    const summary = {
      kind: "session-check",
      session: {
        mode: remote ? "remote" : "local",
        profileEvidence: profile.profileEvidence,
        verified,
        destination,
      },
      ...(finalUrl ? { finalUrl: safePageUrl(finalUrl) } : {}),
    };

    console.log(`Profile dir: ${browserProfileDir()}`);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Stored cookies for domain: ${cookies.length}`);
    console.log(
      remote
        ? `Authenticated: ${verified ? "yes" : "no"}`
        : "Authenticated: not checked (local profile inspection only)",
    );

    if (remote && !verified) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

export async function runBlackboardBrowserCommand(command = process.argv[2] || "open") {
  switch (command) {
    case "login":
      await openBlackboard({ mode: "login" });
      break;
    case "open":
      await openBlackboard({ mode: "open" });
      break;
    case "check-session":
      await checkSession({ remote: process.argv.includes("--remote") });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use one of: login, open, check-session");
      process.exitCode = 2;
  }
}
