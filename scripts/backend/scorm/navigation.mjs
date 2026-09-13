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
const launchSurfaceByPage = new WeakMap();

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
  const sourceFramesBeforeAttempt = new Map(
    sourcePage.frames().map((frame) => [frame, frame.url()]),
  );
  const observedPages = new Set([sourcePage]);
  const observedSourceFrames = new Set();
  const sourceOrigin = pageOrigin(sourcePage);
  let armed = false;

  const observePage = (candidate) => {
    if (armed && !pagesBeforeAttempt.has(candidate)) {
      observedPages.add(candidate);
    }
  };

  const observeSourceFrame = (frame) => {
    if (armed) observedSourceFrames.add(frame);
  };

  context.on("page", observePage);
  sourcePage.on("frameattached", observeSourceFrame);
  sourcePage.on("framenavigated", observeSourceFrame);

  function frameBelongsToAttempt(candidate, frame) {
    if (candidate !== sourcePage) return true;
    if (frame === sourcePage.mainFrame()) return true;
    if (!sourceFramesBeforeAttempt.has(frame)) return true;
    // Blackboard may reuse an empty placeholder iframe for its frameset, but
    // an already-loaded player/content iframe predates this click and must not
    // be mistaken for the attempt currently being opened.
    return (
      observedSourceFrames.has(frame) &&
      /^about:blank(?:#.*)?$/i.test(sourceFramesBeforeAttempt.get(frame))
    );
  }

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

    const entries = [];
    for (const candidate of pages) {
      const relation = related.get(candidate) || "unrelated";
      entries.push({
        page: candidate,
        frame: candidate.mainFrame(),
        relation,
        surface: "top-level",
        role: related.has(candidate)
          ? launchPageRole(candidate.url(), target, sourceOrigin)
          : null,
        url: safePageUrl(candidate.url()),
        hostUrl: safePageUrl(candidate.url()),
      });

      if (relation === "unrelated") continue;
      for (const frame of candidate.frames()) {
        if (frame === candidate.mainFrame() || !frameBelongsToAttempt(candidate, frame)) {
          continue;
        }
        entries.push({
          page: candidate,
          frame,
          relation,
          surface: "inline-frame",
          role: launchPageRole(frame.url(), target, sourceOrigin),
          url: safePageUrl(frame.url()),
          hostUrl: safePageUrl(candidate.url()),
        });
      }
    }
    return {
      entries,
      unrelatedCount: entries.filter((entry) => entry.relation === "unrelated").length,
    };
  }

  return {
    arm() {
      armed = true;
    },
    dispose() {
      context.removeListener("page", observePage);
      sourcePage.removeListener("frameattached", observeSourceFrame);
      sourcePage.removeListener("framenavigated", observeSourceFrame);
    },
    snapshot,
    pagesBeforeAttempt,
  };
}

function attemptDiagnostics(snapshot) {
  const related = snapshot.entries.filter((entry) => entry.relation !== "unrelated");
  const roles = related
    .map(
      (entry) =>
        `${entry.relation}:${entry.surface}:${entry.role || "unknown"}:${entry.url}`,
    )
    .join(", ");
  return `observed launch surfaces: ${roles || "none"}; unrelated pages: ${snapshot.unrelatedCount}`;
}

async function eligiblePlayerEntries(snapshot) {
  const players = snapshot.entries.filter(
    (entry) => entry.relation !== "unrelated" && isPlayerRole(entry.role),
  );
  // A real content frame normally appears beneath modern.html or indexAPI.html.
  // Once a player document is present, it is the stable root for waitForFrame();
  // counting its descendant content as a second player would make every frameset
  // launch look ambiguous.
  if (players.length > 0) return players;

  const content = [];
  for (const entry of snapshot.entries) {
    if (entry.relation === "unrelated") continue;
    if (entry.role === "content-window" && (await isContentFrame(entry.frame))) {
      content.push(entry);
    }
  }
  return content;
}

async function waitForScormPlayer(tracker) {
  const deadline = Date.now() + ATTEMPT_LAUNCH_TIMEOUT_MS;
  let lastSnapshot = await tracker.snapshot();

  while (Date.now() < deadline) {
    const players = await eligiblePlayerEntries(lastSnapshot);
    if (players.length === 1) {
      return {
        page: players[0].page,
        frame: players[0].frame,
        surface: players[0].surface,
        pagesBeforeAttempt: tracker.pagesBeforeAttempt,
        metadata: {
          playerRole: players[0].role,
          playerUrl: players[0].url,
          hostUrl: players[0].hostUrl,
          relation: players[0].relation,
          surface: players[0].surface,
          bridgeSeen: lastSnapshot.entries.some(
            (entry) => entry.relation !== "unrelated" && entry.role === "launch-frame",
          ),
          unrelatedPageCount: lastSnapshot.unrelatedCount,
        },
      };
    }
    if (players.length > 1) {
      throw new Error(
        `SCORM attempt exposed multiple eligible player surfaces. ${attemptDiagnostics(
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
      `SCORM attempt reached Blackboard launch frame but did not expose a supported player or content surface. ${attemptDiagnostics(
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
    attemptTracker.arm();
    await attemptControl.click();
    player = await waitForScormPlayer(attemptTracker);
  } finally {
    attemptTracker.dispose();
  }

  const scormPage = player.page;
  launchSurfaceByPage.set(scormPage, {
    frame: player.frame,
    surface: player.surface,
    pagesBeforeAttempt: player.pagesBeforeAttempt,
  });

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

async function isContentFrame(frame) {
  if (frame.isDetached()) return false;
  return frame.evaluate((namedContent) => {
    if (!/^https?:$/.test(location.protocol) || document.readyState === "loading" || !document.body?.childElementCount) return false;
    // Blackboard first inserts a driver/bootstrap document into this same named
    // iframe. Its existence is not evidence that the SCO has loaded yet.
    if (/\/scormdriver(?:\/|$)|\/scorm\/launchFrame(?:\/|$)|\/defaultui\/player\//i.test(location.pathname)) return false;
    if (document.querySelector('input[type="password"], form[action*="login"]')) return false;
    return /\/scormcontent(?:\/|$)/i.test(location.pathname) ||
      (namedContent && !!document.querySelector("a.overview-list-item__link, .lesson__content, [data-block-id]"));
  }, frame.name() === "scormdriver_content").catch(() => false);
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

function isFrameWithin(frame, ancestor) {
  const visited = new Set();
  let current = frame;
  while (current && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current);
    current = current.parentFrame();
  }
  return false;
}

async function contentFrameInLaunchFamily(page) {
  const origin = pageOrigin(page);
  if (!origin) return null;
  const binding = launchSurfaceByPage.get(page);
  const launchSurface =
    binding?.frame && !binding.frame.isDetached()
      ? binding.frame
      : page.mainFrame();
  const content = [];
  if (!page.isClosed()) {
    for (const frame of page.frames()) {
      if (!isFrameWithin(frame, launchSurface)) continue;
      if (await isContentFrame(frame)) content.push(frame);
    }
  }
  const candidates = page
    .context()
    .pages()
    .filter((candidate) => candidate !== page && !candidate.isClosed?.());

  for (const candidate of candidates) {
    if (binding?.pagesBeforeAttempt?.has(candidate)) continue;
    if (pageOrigin(candidate) !== origin) continue;
    if (!/\/scormcontent(?:\/|$)/i.test(candidate.url())) continue;
    if (await isDescendantPopup(candidate, page)) {
      if (await isContentFrame(candidate.mainFrame())) content.push(candidate.mainFrame());
    }
  }
  if (content.length > 1) throw new Error("SCORM player opened multiple usable content surfaces; refusing to select one arbitrarily.");
  return content[0] || null;
}

export async function waitForFrame(page, { timeout = CONTENT_FRAME_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!page.context().pages().some((candidate) => !candidate.isClosed())) {
      throw new Error("SCORM content window was closed before its content became ready.");
    }
    const frame = await contentFrameInLaunchFamily(page);
    if (frame) return frame;
    await delay(POLL_INTERVAL_MS);
  }

  const surface = launchSurfaceByPage.get(page)?.surface;
  const playerLabel = surface === "inline-frame" ? "SCORM inline player" : "SCORM player";
  throw new Error(
    `${playerLabel} was opened but its content surface did not become ready. Player: ${safePageUrl(
      page.url(),
    )}`,
  );
}
