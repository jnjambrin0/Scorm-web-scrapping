import {
  configuredCourseOutlineUrl,
  configuredBlackboardBaseUrl,
  configuredScormTitle,
} from "../shared/env.mjs";
import {
  matchingScormTargetIndexes,
  parseScormUrl,
} from "./urls.mjs";
import {
  classifySessionDestination,
  safePageUrl,
} from "../browser/session-state.mjs";

const navigationMetadataByPage = new WeakMap();

export function scormNavigationMetadata(page) {
  return navigationMetadataByPage.get(page) || null;
}

function requireCourseOutlineUrl() {
  const url = configuredCourseOutlineUrl();
  if (!url) {
    throw new Error(
      "COURSE_OUTLINE_URL is empty. Paste the Blackboard URL in the form before running an export.",
    );
  }
  return url;
}

function requireBlackboardBaseUrl() {
  const url = configuredBlackboardBaseUrl();
  if (!url) {
    throw new Error(
      "BLACKBOARD_BASE_URL is empty. Configure the Blackboard Stream URL before opening SCORM.",
    );
  }
  return url;
}

function requireScormTitle() {
  const title = configuredScormTitle();
  if (!title) {
    throw new Error(
      "SCORM_TITLE is empty. When the URL points to a course outline (not a direct SCORM), fill in the optional unit title in the form.",
    );
  }
  return title;
}

// Blackboard's "concurrent session" modal looks like a dismiss dialog, but its
// "Cerrar" button is not a no-op — clicking it tells Blackboard to consolidate
// the session into THIS browser and invalidate every other active session for
// the same account (personal Chrome, other devices, mobile app). Doing that
// from automation logs the user out everywhere else, which is precisely the
// bug we're fixing. We must never click any button on this modal.
//
// Instead, remove the modal node client-side. No HTTP request reaches
// Blackboard, so no other session is killed. Asset downloads use
// `frame.evaluate(() => fetch(...))` with `credentials: "include"` inside the
// SCORM iframe; they don't depend on the host DOM, so the overlay never
// actually blocked them — we only needed it out of the way for the `click()`
// calls higher up the page.
async function dismissConcurrentSessionModal(page) {
  await page
    .evaluate(() => {
      document.querySelector("#concurrent-session-bbmodal")?.remove();
      document.querySelector(".bb-modal-backdrop")?.remove();
    })
    .catch(() => {});
}

async function settleNavigation(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await page.locator("body").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await page
    .waitForFunction(() => Boolean(document.body?.innerText.trim()), { timeout: 5000 })
    .catch(() => {});
}

async function pageDestination(page, baseUrl, target = null) {
  const currentUrl = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const hasPasswordField =
    (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
  const sessionDestination = classifySessionDestination({
    currentUrl,
    baseUrl,
    title,
    bodyText: bodyText.slice(0, 1500),
    hasPasswordField,
  });

  if (sessionDestination === "login") {
    return "login";
  }
  const currentTarget = parseScormUrl(currentUrl);
  if (target && currentTarget?.identity === target.identity) {
    return "scorm";
  }
  if (/\/ultra\/stream(?:\/|$)/i.test(new URL(currentUrl).pathname)) {
    return "stream";
  }
  return sessionDestination;
}

async function isAuthenticatedBlackboardPage(page, baseUrl) {
  const title = await page.title().catch(() => "");
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const hasPasswordField =
    (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
  return (
    classifySessionDestination({
      currentUrl: page.url(),
      baseUrl,
      title,
      bodyText: bodyText.slice(0, 1500),
      hasPasswordField,
    }) === "blackboard"
  );
}

async function waitForAuthenticatedBlackboardPage(page, baseUrl, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await isAuthenticatedBlackboardPage(page, baseUrl)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function navigationSummary(page, destination) {
  const title = await page.title().catch(() => "");
  return `${destination}; final URL ${safePageUrl(page.url())}; title ${JSON.stringify(
    title,
  )}`;
}

async function readHrefs(page) {
  return page.locator("a").evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") || ""),
  );
}

function comparableUrl(value, baseUrl) {
  try {
    const parsed = new URL(value, baseUrl);
    parsed.hash = "";
    const sortedParams = [...parsed.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    parsed.search = new URLSearchParams(sortedParams).toString();
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function matchingUrlIndex(hrefs, pageUrl, targetUrl) {
  const expected = comparableUrl(targetUrl, pageUrl);
  if (!expected) return -1;

  return hrefs.findIndex(
    (href) => comparableUrl(href, pageUrl) === expected,
  );
}

async function clickLinkAt(page, index) {
  if (index < 0) return false;
  await page.locator("a").nth(index).click();
  await settleNavigation(page);
  return true;
}

function safeHref(pageUrl, href) {
  try {
    return safePageUrl(new URL(href, pageUrl).href);
  } catch {
    return "invalid";
  }
}

const ATTEMPT_LAUNCH_TIMEOUT_MS = 20000;
const CONTENT_FRAME_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 100;

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function launchPageRole(value, target, expectedOrigin) {
  if (typeof value !== "string" || !expectedOrigin) return null;

  try {
    const parsed = new URL(value);
    if (parsed.origin !== expectedOrigin) return null;

    const launchFrame = parsed.pathname.match(
      /^\/ultra\/courses\/([^/]+)\/(?:[^/]+\/)*scorm\/launchFrame(?:\/|$)/i,
    );
    if (launchFrame && target && decodePathPart(launchFrame[1]) === target.courseId) {
      return "launch-frame";
    }
    if (/\/scormdriver\/indexAPI\.html$/i.test(parsed.pathname)) {
      return "legacy-player";
    }
    if (
      /\/webapps\/scor-scormengine-[^/]+\/defaultui\/player\/(?:modern|deliver)\.html$/i.test(
        parsed.pathname,
      )
    ) {
      return "engine-player";
    }
    if (/\/scormcontent(?:\/|$)/i.test(parsed.pathname)) {
      return "content-window";
    }
  } catch {
    return null;
  }

  return null;
}

function isPlayerRole(role) {
  return role === "legacy-player" || role === "engine-player";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createAttemptLaunchTracker(context, sourcePage, target) {
  const pagesBeforeAttempt = new Set(context.pages());
  const observedPages = new Set([sourcePage]);
  const sourceOrigin = pageOrigin(sourcePage);

  const observePage = (candidate) => {
    if (!pagesBeforeAttempt.has(candidate)) {
      observedPages.add(candidate);
    }
  };

  context.on("page", observePage);

  async function snapshot() {
    const pages = [...observedPages].filter(
      (candidate) => !candidate.isClosed?.(),
    );
    const related = new Map([[sourcePage, "source"]]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const candidate of pages) {
        if (related.has(candidate)) continue;
        const opener = await candidate.opener().catch(() => null);
        if (opener && related.has(opener)) {
          related.set(
            candidate,
            related.get(opener) === "source" ? "popup" : "descendant-popup",
          );
          changed = true;
        }
      }
    }

    const entries = pages.map((candidate) => ({
      page: candidate,
      relation: related.get(candidate) || "unrelated",
      role: related.has(candidate)
        ? launchPageRole(candidate.url(), target, sourceOrigin)
        : null,
      url: safePageUrl(candidate.url()),
    }));
    return {
      entries,
      unrelatedCount: entries.filter((entry) => entry.relation === "unrelated").length,
    };
  }

  return {
    dispose() {
      context.removeListener("page", observePage);
    },
    snapshot,
  };
}

function attemptDiagnostics(snapshot) {
  const related = snapshot.entries.filter((entry) => entry.relation !== "unrelated");
  const roles = related
    .map((entry) => `${entry.relation}:${entry.role || "unknown"}:${entry.url}`)
    .join(", ");
  return `observed pages: ${roles || "none"}; unrelated pages: ${snapshot.unrelatedCount}`;
}

async function waitForScormPlayer(tracker, target) {
  const deadline = Date.now() + ATTEMPT_LAUNCH_TIMEOUT_MS;
  let lastSnapshot = await tracker.snapshot();

  while (Date.now() < deadline) {
    const players = lastSnapshot.entries.filter(
      (entry) => entry.relation !== "unrelated" && isPlayerRole(entry.role),
    );
    if (players.length === 1) {
      return {
        page: players[0].page,
        metadata: {
          playerRole: players[0].role,
          playerUrl: players[0].url,
          relation: players[0].relation,
          bridgeSeen: lastSnapshot.entries.some(
            (entry) => entry.relation !== "unrelated" && entry.role === "launch-frame",
          ),
          unrelatedPageCount: lastSnapshot.unrelatedCount,
        },
      };
    }
    if (players.length > 1) {
      throw new Error(
        `SCORM attempt opened multiple eligible player pages. ${attemptDiagnostics(
          lastSnapshot,
        )}`,
      );
    }
    await delay(POLL_INTERVAL_MS);
    lastSnapshot = await tracker.snapshot();
  }

  const bridgeSeen = lastSnapshot.entries.some(
    (entry) => entry.relation !== "unrelated" && entry.role === "launch-frame",
  );
  if (bridgeSeen) {
    throw new Error(
      `SCORM attempt reached Blackboard launch frame but did not open a supported player. ${attemptDiagnostics(
        lastSnapshot,
      )}`,
    );
  }
  throw new Error(
    `SCORM attempt did not create or navigate to a supported player page. ${attemptDiagnostics(
      lastSnapshot,
    )}`,
  );
}

async function navigateTo(page, url, baseUrl, target = null) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    throw new Error(
      `Could not navigate to Blackboard URL ${safePageUrl(url)}: ${error.message}`,
    );
  }

  await settleNavigation(page);
  const destination = await pageDestination(page, baseUrl, target);
  console.log(`Navigation: ${destination}; final URL: ${safePageUrl(page.url())}.`);
  return {
    destination,
    responseStatus: response?.status() ?? null,
  };
}

async function bootstrapBlackboardPage(page, baseUrl) {
  console.log(`Blackboard SCORM bootstrap: opening ${safePageUrl(baseUrl)}.`);
  const { destination, responseStatus } = await navigateTo(page, baseUrl, baseUrl);
  await dismissConcurrentSessionModal(page);
  if (destination === "login") {
    throw new Error(
      `Blackboard bootstrap requires login. Final destination: ${safePageUrl(page.url())}`,
    );
  }
  if (responseStatus !== null && responseStatus >= 400) {
    throw new Error(
      `Blackboard bootstrap returned HTTP ${responseStatus}. ${await navigationSummary(
        page,
        destination,
      )}`,
    );
  }
  if (!(await waitForAuthenticatedBlackboardPage(page, baseUrl))) {
    throw new Error(
      `Blackboard bootstrap did not reach an authenticated page. ${await navigationSummary(
        page,
        destination,
      )}`,
    );
  }
  const resolvedUrl = safePageUrl(page.url());
  console.log(`Blackboard SCORM bootstrap ready: ${resolvedUrl}.`);
  return { resolvedUrl };
}

async function assertDirectScormResponse(responseStatus, page, destination) {
  if (responseStatus === null || responseStatus < 400) return;
  throw new Error(
    `Direct SCORM source returned HTTP ${responseStatus}. ${await navigationSummary(
      page,
      destination,
    )}`,
  );
}

export async function openCourseOutline(page, { baseUrl: suppliedBaseUrl } = {}) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  const baseUrl = suppliedBaseUrl || new URL(courseOutlineUrl).origin;
  const target = parseScormUrl(courseOutlineUrl);

  if (target) {
    let attempts = 1;
    let { destination, responseStatus } = await navigateTo(
      page,
      target.inputUrl,
      baseUrl,
      target,
    );
    await dismissConcurrentSessionModal(page);

    if (destination === "login") {
      throw new Error(
        `Blackboard session expired or login is required. Final destination: ${safePageUrl(
          page.url(),
        )}`,
      );
    }
    await assertDirectScormResponse(responseStatus, page, destination);
    if (parseScormUrl(page.url())?.identity === target.identity) {
      console.log(
        `Direct SCORM source resolved by Blackboard: source ${safePageUrl(
          target.inputUrl,
        )}; destination ${safePageUrl(page.url())}.`,
      );
      return {
        sourceUrl: safePageUrl(target.inputUrl),
        resolvedUrl: safePageUrl(page.url()),
        attempts,
        resolution: "server-route",
      };
    }

    if (destination === "stream") {
      attempts += 1;
      console.log(
        `Direct SCORM source reached Stream; retrying the exact source URL (attempt ${attempts}).`,
      );
      ({ destination, responseStatus } = await navigateTo(
        page,
        target.inputUrl,
        baseUrl,
        target,
      ));
      await dismissConcurrentSessionModal(page);
      if (destination === "login") {
        throw new Error(
          `Blackboard session expired or login is required. Final destination: ${safePageUrl(
            page.url(),
          )}`,
        );
      }
      await assertDirectScormResponse(responseStatus, page, destination);
      if (parseScormUrl(page.url())?.identity === target.identity) {
        console.log(
          `Direct SCORM source resolved after exact retry: ${safePageUrl(page.url())}.`,
        );
        return {
          sourceUrl: safePageUrl(target.inputUrl),
          resolvedUrl: safePageUrl(page.url()),
          attempts,
          resolution: "exact-retry",
        };
      }
    }

    const hrefs = await readHrefs(page);
    const matchingIndexes = matchingScormTargetIndexes(hrefs, page.url(), target);
    if (matchingIndexes.length === 0) {
      throw new Error(
        `Direct SCORM source did not render a matching SCORM link. ${await navigationSummary(
          page,
          destination,
        )}; candidate links: ${hrefs.length}`,
      );
    }
    if (matchingIndexes.length > 1) {
      throw new Error(
        `Direct SCORM source rendered multiple matching SCORM links. ${await navigationSummary(
          page,
          destination,
        )}; matches: ${matchingIndexes.length}`,
      );
    }

    const index = matchingIndexes[0];
    console.log(
      `Direct SCORM DOM resolution: source ${safePageUrl(
        target.inputUrl,
      )}; landing ${safePageUrl(page.url())}; selected ${safeHref(page.url(), hrefs[index])}.`,
    );
    await clickLinkAt(page, index);
    await dismissConcurrentSessionModal(page);
    const selectedDestination = await pageDestination(page, baseUrl, target);
    if (selectedDestination === "login") {
      throw new Error(
        `Blackboard session expired or login is required. Final destination: ${safePageUrl(
          page.url(),
        )}`,
      );
    }
    if (parseScormUrl(page.url())?.identity === target.identity) {
      return {
        sourceUrl: safePageUrl(target.inputUrl),
        resolvedUrl: safePageUrl(page.url()),
        attempts,
        resolution: "dom-link",
      };
    }

    throw new Error(
      `Direct SCORM resolved link did not open the expected item. ${await navigationSummary(
        page,
        selectedDestination,
      )}`,
    );
  }

  const { destination } = await navigateTo(page, courseOutlineUrl, baseUrl);
  await dismissConcurrentSessionModal(page);
  if (destination === "login") {
    throw new Error(
      `Blackboard session expired or login is required. Final destination: ${safePageUrl(
        page.url(),
      )}`,
    );
  }

  if (destination === "stream") {
    const hrefs = await readHrefs(page);
    const courseIndex = matchingUrlIndex(hrefs, page.url(), courseOutlineUrl);
    if (!(await clickLinkAt(page, courseIndex))) {
      throw new Error(
        `Could not find course link: ${courseOutlineUrl}. ${await navigationSummary(
          page,
          destination,
        )}`,
      );
    }
  }

  await dismissConcurrentSessionModal(page);
  return {
    sourceUrl: safePageUrl(courseOutlineUrl),
    resolvedUrl: safePageUrl(page.url()),
    attempts: 1,
    resolution: "outline",
  };
}

export async function openScorm(context) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  const baseUrl = requireBlackboardBaseUrl();
  const directTarget = parseScormUrl(courseOutlineUrl);
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  const bootstrap = await bootstrapBlackboardPage(page, baseUrl);
  const sourceNavigation = await openCourseOutline(page, { baseUrl });

  if (!directTarget) {
    const unitTitle = requireScormTitle();
    const unitHeader = page.getByText(unitTitle, { exact: true });
    if ((await unitHeader.count()) < 1) {
      throw new Error(`Could not find unit header: ${unitTitle}`);
    }

    await unitHeader.first().click();
    await page.waitForTimeout(1500);

    const scormItem = page.locator("a").filter({ hasText: unitTitle });
    if ((await scormItem.count()) < 1) {
      throw new Error(`Could not find SCORM item link: ${unitTitle}`);
    }

    await scormItem.first().click();
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissConcurrentSessionModal(page);
  }

  const expectedScormTarget = directTarget || parseScormUrl(page.url());

  const attemptControl = page
    .getByText(
      /(?:Continuar|Iniciar)\s+intento\s*\d*|(?:Continue|Start)\s+attempt\s*\d*/i,
    )
    .first();
  try {
    await attemptControl.waitFor({ state: "visible", timeout: 20000 });
  } catch {
    const destination = await pageDestination(page, baseUrl, directTarget);
    if (destination === "login") {
      throw new Error(
        `Blackboard session expired or login is required. Final destination: ${safePageUrl(
          page.url(),
        )}`,
      );
    }
    throw new Error(
      `Could not find Start/Continue attempt control. ${await navigationSummary(
        page,
        destination,
      )}`,
    );
  }

  const attemptTracker = createAttemptLaunchTracker(
    context,
    page,
    expectedScormTarget,
  );
  let player;
  try {
    await attemptControl.click();
    player = await waitForScormPlayer(attemptTracker, expectedScormTarget);
  } finally {
    attemptTracker.dispose();
  }

  const scormPage = player.page;

  await scormPage
    .waitForLoadState("domcontentloaded", { timeout: 20000 })
    .catch(() => {});
  await dismissConcurrentSessionModal(scormPage);
  navigationMetadataByPage.set(scormPage, {
    bootstrap,
    source: sourceNavigation,
    attempt: player.metadata,
  });
  return scormPage;
}

function contentFrameOnPage(page) {
  return (
    page.frames().find(
      (candidate) =>
        candidate.name() === "scormdriver_content" &&
        !/^about:blank(?:#.*)?$/i.test(candidate.url()),
    ) ||
    page.frames().find((candidate) => /\/scormcontent(?:\/|$)/i.test(candidate.url())) ||
    null
  );
}

function pageOrigin(page) {
  try {
    return new URL(page.url()).origin;
  } catch {
    return null;
  }
}

async function isDescendantPopup(candidate, ancestor) {
  const visited = new Set();
  let current = candidate;
  while (current && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current);
    current = await current.opener().catch(() => null);
  }
  return false;
}

async function contentFrameInLaunchFamily(page) {
  const ownFrame = contentFrameOnPage(page);
  if (ownFrame) return ownFrame;

  const origin = pageOrigin(page);
  if (!origin) return null;
  const candidates = page
    .context()
    .pages()
    .filter((candidate) => candidate !== page && !candidate.isClosed?.());

  for (const candidate of candidates) {
    if (pageOrigin(candidate) !== origin) continue;
    if (!/\/scormcontent(?:\/|$)/i.test(candidate.url())) continue;
    if (await isDescendantPopup(candidate, page)) {
      return candidate.mainFrame();
    }
  }
  return null;
}

export async function waitForFrame(page, { timeout = CONTENT_FRAME_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = await contentFrameInLaunchFamily(page);
    if (frame) return frame;
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `SCORM player was opened but its content surface did not become ready. Player: ${safePageUrl(
      page.url(),
    )}`,
  );
}
