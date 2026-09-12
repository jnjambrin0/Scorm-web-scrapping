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
  if (!(await isAuthenticatedBlackboardPage(page, baseUrl))) {
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
  navigationMetadataByPage.set(scormPage, {
    bootstrap,
    source: sourceNavigation,
  });
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
