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

function isPageClosedError(error) {
  return /(?:target page, context or browser has been closed|page closed|browser closed)/i.test(
    error?.message || String(error || ""),
  );
}

async function inspectSessionPage(page, baseUrl) {
  let currentUrl;
  try {
    currentUrl = page.url();
  } catch {
    return { destination: "unknown", currentUrl: "about:blank" };
  }

  if (!currentUrl || currentUrl === "about:blank") {
    return { destination: "unknown", currentUrl: "about:blank" };
  }

  const title = await page.title().catch(() => "");
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const hasPasswordField =
    (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;

  return {
    destination: classifySessionDestination({
      currentUrl,
      baseUrl,
      title,
      bodyText: bodyText.slice(0, 1500),
      hasPasswordField,
    }),
    currentUrl,
  };
}

// Resolves from authentication, not from a user manually closing a browser.
// Page-level close events are used because BrowserContext `pageclose` was not
// available in the project's Playwright 1.59.1.
export function waitForAuthenticationOutcome(
  context,
  {
    baseUrl,
    emptyGraceMs = EMPTY_CONTEXT_GRACE_MS,
    emptyPollMs = 500,
    onObservation = () => {},
  } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    let emptyTimer = null;
    let emptyPagePoll = null;
    let lastObservation = {
      destination: "unknown",
      currentUrl: "about:blank",
    };
    const pageCleanups = new Map();

    const cleanup = () => {
      if (emptyTimer) clearTimeout(emptyTimer);
      if (emptyPagePoll) clearInterval(emptyPagePoll);
      context.removeListener("page", handleContextPage);
      context.removeListener("close", handleContextClose);
      for (const remove of pageCleanups.values()) remove();
      pageCleanups.clear();
    };

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        outcome,
        destination: lastObservation.destination,
        finalUrl: safePageUrl(lastObservation.currentUrl),
      });
    };

    const scheduleEmptyCheck = () => {
      if (settled || context.pages().length > 0) {
        if (emptyTimer) clearTimeout(emptyTimer);
        emptyTimer = null;
        return;
      }
      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = setTimeout(() => {
        emptyTimer = null;
        if (!settled && context.pages().length === 0) {
          finish("closed-before-verification");
        }
      }, emptyGraceMs);
    };

    const observe = async (page) => {
      if (settled) return;
      const observation = await inspectSessionPage(page, baseUrl);
      if (settled || observation.currentUrl === "about:blank") return;
      lastObservation = observation;
      try {
        onObservation(observation);
      } catch {
        // Reporting must never block authentication or cleanup.
      }
      if (observation.destination === "blackboard") {
        finish("verified");
      }
    };

    const trackPage = (page) => {
      if (pageCleanups.has(page)) return;
      const onFrameNavigated = (frame) => {
        try {
          if (frame === page.mainFrame()) void observe(page);
        } catch {
          // Pages may close while Playwright is delivering an event.
        }
      };
      const onLoad = () => void observe(page);
      const onClose = () => scheduleEmptyCheck();
      page.on("framenavigated", onFrameNavigated);
      page.on("load", onLoad);
      page.on("close", onClose);
      pageCleanups.set(page, () => {
        page.removeListener("framenavigated", onFrameNavigated);
        page.removeListener("load", onLoad);
        page.removeListener("close", onClose);
      });
      void observe(page);
    };

    const handleContextPage = (page) => {
      if (emptyTimer) clearTimeout(emptyTimer);
      emptyTimer = null;
      trackPage(page);
    };
    const handleContextClose = () => finish("closed-before-verification");

    context.on("page", handleContextPage);
    context.on("close", handleContextClose);
    for (const page of context.pages()) trackPage(page);
    scheduleEmptyCheck();
    emptyPagePoll = setInterval(scheduleEmptyCheck, emptyPollMs);
  });
}

function installGracefulShutdown(context) {
  let requested = false;
  const closeContext = () => {
    if (requested) return;
    requested = true;
    void context.close().catch(() => {});
  };

  process.once("SIGINT", closeContext);
  process.once("SIGTERM", closeContext);
  return () => {
    process.removeListener("SIGINT", closeContext);
    process.removeListener("SIGTERM", closeContext);
  };
}

async function navigateForInteractiveAuthentication(context, page, baseUrl) {
  const outcomePromise = waitForAuthenticationOutcome(context, {
    baseUrl,
    onObservation: ({ destination, currentUrl }) => {
      console.log(`Navigation: ${destination}; URL: ${safePageUrl(currentUrl)}.`);
    },
  });

  const navigationResult = await Promise.race([
    page
      .goto(baseUrl, { waitUntil: "domcontentloaded" })
      .then(() => ({ kind: "navigated" }))
      .catch((error) => ({ kind: "navigation-error", error })),
    outcomePromise.then((outcome) => ({ kind: "outcome", outcome })),
  ]);

  if (navigationResult.kind === "navigation-error" && !isPageClosedError(navigationResult.error)) {
    throw new Error(
      `Could not open Blackboard at ${safePageUrl(baseUrl)}: ${navigationResult.error.message}`,
    );
  }

  if (navigationResult.kind === "outcome") {
    return navigationResult.outcome;
  }
  return outcomePromise;
}

function createSessionSummary({
  remote,
  interactive,
  profileEvidence,
  destination,
  outcome,
}) {
  const verified = remote && destination === "blackboard" && outcome === "verified";
  return {
    kind: "session-check",
    session: {
      mode: remote ? "remote" : "local",
      interaction: interactive ? "manual" : "none",
      profileEvidence,
      verified,
      destination,
      ...(outcome ? { outcome } : {}),
    },
  };
}

export async function openBlackboard({ mode }) {
  const baseUrl = requireBlackboardBaseUrl();

  if (mode === "login") {
    await loginToBlackboard(baseUrl);
    return;
  }

  const context = await launchPersistentContext({ headless: false });
  const stopGracefulShutdown = installGracefulShutdown(context);
  const page = context.pages()[0] || (await context.newPage());
  console.log(`Profile dir: ${browserProfileDir()}`);
  console.log("Using the saved browser profile. Close the window when done.");

  try {
    const closePromise = waitUntilUserCloses(context);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await closePromise;
  } finally {
    stopGracefulShutdown();
    await context.close().catch(() => {});
  }
}

async function loginToBlackboard(baseUrl) {
  const context = await launchPersistentContext({ headless: false });
  const stopGracefulShutdown = installGracefulShutdown(context);
  const page = context.pages()[0] || (await context.newPage());

  console.log(`Profile dir: ${browserProfileDir()}`);
  console.log("Login browser opened. There is no time limit for entering credentials.");
  console.log("Complete Blackboard login manually. This window closes after Blackboard confirms the session.");

  try {
    const result = await navigateForInteractiveAuthentication(context, page, baseUrl);
    const cookies = await context.cookies(baseUrl);
    const profile = inspectProfileCookies(cookies);
    const reachedBlackboard = result.outcome === "verified";
    const summary = {
      kind: "login",
      reachedBlackboard,
      destination: result.destination,
      session: {
        mode: "remote",
        interaction: "manual",
        profileEvidence: profile.profileEvidence,
        verified: reachedBlackboard,
        destination: result.destination,
        outcome: result.outcome,
      },
    };
    console.log(JSON.stringify(summary, null, 2));

    if (!reachedBlackboard) {
      process.exitCode = 1;
      throw new Error(
        `Login window closed before reaching Blackboard. Last destination: ${result.destination}; URL: ${result.finalUrl}`,
      );
    }
  } finally {
    stopGracefulShutdown();
    await context.close().catch(() => {});
  }
}

// Wait until the user is done with the debug browser. We cannot rely only on
// BrowserContext close on macOS because Chromium can retain its process after
// its last window disappears.
export function waitUntilUserCloses(
  context,
  {
    emptyGraceMs = EMPTY_CONTEXT_GRACE_MS,
    emptyPollMs = 500,
    onNavigate = () => {},
    onPageClosed = () => {},
  } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    let emptyTimer = null;
    let requestedCloseReason = null;
    let emptyPagePoll = null;
    const trackedPages = new Map();
    const pendingNavigationObservers = new Set();

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      if (emptyTimer) clearTimeout(emptyTimer);
      if (emptyPagePoll) clearInterval(emptyPagePoll);
      context.removeListener("close", handleContextClose);
      context.removeListener("page", handleContextPage);
      for (const remove of trackedPages.values()) remove();
      Promise.allSettled(pendingNavigationObservers).then(() => resolve({ reason }));
    };

    const handleContextClose = () => finish(requestedCloseReason || "context-closed");
    const scheduleEmptyCheck = () => {
      if (settled || context.pages().length > 0) {
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
      const onFrameNavigated = (frame) => {
        try {
          if (frame === page.mainFrame()) dispatchNavigation();
        } catch {
          // The page can close while Playwright is delivering the event.
        }
      };
      const onLoad = () => dispatchNavigation();
      const onClose = () => {
        try {
          onPageClosed(page);
        } catch {
          // Diagnostics must never prevent cleanup.
        }
        scheduleEmptyCheck();
      };
      page.on("framenavigated", onFrameNavigated);
      page.on("load", onLoad);
      page.on("close", onClose);
      trackedPages.set(page, () => {
        page.removeListener("framenavigated", onFrameNavigated);
        page.removeListener("load", onLoad);
        page.removeListener("close", onClose);
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

    context.on("close", handleContextClose);
    context.on("page", handleContextPage);
    for (const page of context.pages()) trackPage(page);
    scheduleEmptyCheck();
    emptyPagePoll = setInterval(scheduleEmptyCheck, emptyPollMs);
  });
}

export async function checkSession({ remote = false, interactive = false } = {}) {
  if (interactive && !remote) {
    throw new Error("Interactive session verification requires --remote.");
  }

  const baseUrl = requireBlackboardBaseUrl();
  const context = await launchPersistentContext({
    headless: !(remote && interactive),
  });
  const stopGracefulShutdown = installGracefulShutdown(context);

  try {
    let destination = "not-checked";
    let finalUrl = null;
    let outcome = null;

    if (remote) {
      const page = context.pages()[0] || (await context.newPage());
      page.setDefaultNavigationTimeout(30000);
      if (interactive) {
        console.log("Blackboard verification opened. Complete login manually if requested.");
        const result = await navigateForInteractiveAuthentication(context, page, baseUrl);
        destination = result.destination;
        finalUrl = result.finalUrl;
        outcome = result.outcome;
      } else {
        try {
          await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        } catch (error) {
          throw new Error(
            `Could not remotely verify Blackboard at ${safePageUrl(baseUrl)}: ${error.message}`,
          );
        }
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        const observation = await inspectSessionPage(page, baseUrl);
        destination = observation.destination;
        finalUrl = safePageUrl(observation.currentUrl);
        outcome = destination === "blackboard" ? "verified" : "login-required";
      }
    }

    const cookies = await context.cookies(baseUrl);
    const profile = inspectProfileCookies(cookies);
    const summary = createSessionSummary({
      remote,
      interactive,
      profileEvidence: profile.profileEvidence,
      destination,
      outcome,
    });

    console.log(`Profile dir: ${browserProfileDir()}`);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Stored cookies for domain: ${cookies.length}`);
    console.log(
      remote
        ? `Authenticated: ${summary.session.verified ? "yes" : "no"}`
        : "Authenticated: not checked (local profile inspection only)",
    );

    if (remote && !summary.session.verified) {
      process.exitCode = 1;
      if (interactive && outcome === "closed-before-verification") {
        console.error("Interactive Blackboard verification was closed before authentication completed.");
      }
    }
  } finally {
    stopGracefulShutdown();
    await context.close().catch(() => {});
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
      await checkSession({
        remote: process.argv.includes("--remote"),
        interactive: process.argv.includes("--interactive"),
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use one of: login, open, check-session");
      process.exitCode = 2;
  }
}
