import {
  configuredCourseOutlineUrl,
  configuredScormTitle,
} from "../shared/env.mjs";
import {
  matchingScormTargetIndex,
  parseScormUrl,
  scormUrlCandidates,
} from "./urls.mjs";
import {
  classifySessionDestination,
  safePageUrl,
} from "../browser/session-state.mjs";

function requireCourseOutlineUrl() {
  const url = configuredCourseOutlineUrl();
  if (!url) {
    throw new Error(
      "COURSE_OUTLINE_URL is empty. Paste the Blackboard URL in the form before running an export.",
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
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
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

function safeHref(pageUrl, href) {
  try {
    return safePageUrl(new URL(href, pageUrl).href);
  } catch {
    return "invalid";
  }
}

async function clickLinkAt(page, index) {
  if (index < 0) return false;
  await page.locator("a").nth(index).click();
  await settleNavigation(page);
  return true;
}

async function resolveScormTargetFromPage(page, baseUrl, target, currentDestination) {
  const hrefs = await readHrefs(page);
  const targetIndex = matchingScormTargetIndex(hrefs, page.url(), target);
  console.log(
    `SCORM item lookup: target ${target.identity}; links ${hrefs
      .map((href) => safeHref(page.url(), href))
      .join(", ")}; match ${targetIndex}.`,
  );

  if (!(await clickLinkAt(page, targetIndex))) {
    return { resolved: false, destination: currentDestination, hrefs };
  }

  await dismissConcurrentSessionModal(page);
  const destination = await pageDestination(page, baseUrl, target);
  if (destination === "login") {
    throw new Error(
      `Blackboard session expired or login is required. Final destination: ${safePageUrl(
        page.url(),
      )}`,
    );
  }
  return {
    resolved: destination === "scorm",
    destination,
    hrefs,
  };
}

function isScormPlayerUrl(value, target) {
  if (typeof value !== "string") return false;
  if (/\/scormdriver\/indexAPI\.html/i.test(value)) return true;

  try {
    const parsed = new URL(value);
    const sameOrigin = target && parsed.origin === target.origin;
    const sameTarget = target && parseScormUrl(value)?.identity === target.identity;
    return Boolean(
      sameOrigin &&
        sameTarget &&
        /\/scorm\/launchFrame(?:\/|$)|\/scor-scormengine-[^/]+\//i.test(
          parsed.pathname,
        ),
    );
  } catch {
    return false;
  }
}

async function navigateTo(page, url, baseUrl, target = null) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    throw new Error(
      `Could not navigate to Blackboard URL ${safePageUrl(url)}: ${error.message}`,
    );
  }

  await settleNavigation(page);
  const destination = await pageDestination(page, baseUrl, target);
  console.log(`Navigation: ${destination}; final URL: ${safePageUrl(page.url())}.`);
  return destination;
}

export async function openCourseOutline(page) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  const baseUrl = new URL(courseOutlineUrl).origin;
  const target = parseScormUrl(courseOutlineUrl);

  if (target) {
    let lastDestination = "unknown";
    let lastHrefs = [];
    for (const candidate of scormUrlCandidates(courseOutlineUrl)) {
      lastDestination = await navigateTo(page, candidate, baseUrl, target);
      await dismissConcurrentSessionModal(page);

      if (lastDestination === "login") {
        throw new Error(
          `Blackboard session expired or login is required. Final destination: ${safePageUrl(
            page.url(),
          )}`,
        );
      }
      if (lastDestination === "scorm") {
        return;
      }

      // Blackboard can redirect a direct SCORM URL to stream, a course outline,
      // or another same-origin landing page. The actual rendered link is always
      // authoritative over a synthesized route fallback.
      if (lastDestination !== "scorm") {
        const resolution = await resolveScormTargetFromPage(
          page,
          baseUrl,
          target,
          lastDestination,
        );
        lastHrefs = resolution.hrefs;
        lastDestination = resolution.destination;
        if (resolution.resolved) {
          return;
        }
      }
    }

    throw new Error(
      `Could not resolve SCORM item ${target.itemId} for course ${target.courseId}. ${
        await navigationSummary(page, lastDestination)
      }; candidate links: ${lastHrefs.length}`,
    );
  }

  const destination = await navigateTo(page, courseOutlineUrl, baseUrl);
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
}

export async function openScorm(context) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  const baseUrl = new URL(courseOutlineUrl).origin;
  const directTarget = parseScormUrl(courseOutlineUrl);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await openCourseOutline(page);

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

  const popupFromAttempt = context
    .waitForEvent("page", { timeout: 10000 })
    .catch(() => null);
  const samePageNavigation = page
    .waitForURL(/\/scormdriver\/indexAPI\.html/i, { timeout: 10000 })
    .then(() => null)
    .catch(() => null);
  await attemptControl.click();
  const attemptPopup = await Promise.race([popupFromAttempt, samePageNavigation]);

  let scormPage = null;
  const deadline = Date.now() + 15000;
  while (!scormPage && Date.now() < deadline) {
    const candidates = [attemptPopup, page, ...context.pages()].filter(Boolean);
    scormPage = candidates.find((candidate) =>
      isScormPlayerUrl(candidate.url(), expectedScormTarget),
    );
    if (!scormPage) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (!scormPage) {
    const pages = context.pages()
      .map((candidate) => safePageUrl(candidate.url()))
      .join(", ");
    throw new Error(`Could not find SCORM player page after starting attempt. Pages: ${pages}`);
  }

  await scormPage
    .waitForLoadState("domcontentloaded", { timeout: 20000 })
    .catch(() => {});
  await scormPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await dismissConcurrentSessionModal(scormPage);
  return scormPage;
}

export function waitForFrame(page) {
  const frame =
    page.frames().find((candidate) => candidate.name() === "scormdriver_content") ||
    page.frames().find((candidate) =>
      candidate.url().includes("/scormcontent/"),
    );

  if (!frame) {
    throw new Error("Could not find SCORM content frame");
  }

  return frame;
}
