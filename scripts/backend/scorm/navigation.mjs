import {
  configuredCourseOutlineUrl,
  configuredScormTitle,
  isDirectScormUrl,
} from "../shared/env.mjs";

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

async function openCourseOutline(page) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  await page.goto(courseOutlineUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissConcurrentSessionModal(page);

  if (page.url().includes("/ultra/stream")) {
    if (isDirectScormUrl(courseOutlineUrl)) {
      await page.goto(courseOutlineUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await dismissConcurrentSessionModal(page);
      return;
    }

    const courseLinks = page.locator(`a[href="${courseOutlineUrl}"]`);
    if ((await courseLinks.count()) < 1) {
      throw new Error(`Could not find course link: ${courseOutlineUrl}`);
    }

    await courseLinks.first().click();
    await page
      .waitForLoadState("networkidle", { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(4000);
  }

  await dismissConcurrentSessionModal(page);
}

export async function openScorm(context) {
  const courseOutlineUrl = requireCourseOutlineUrl();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await openCourseOutline(page);

  if (!isDirectScormUrl(courseOutlineUrl)) {
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

  const attemptControl = page.getByText(
    /Continuar intento\s*\d*|Iniciar intento\s*\d*/i,
  );
  if ((await attemptControl.count()) < 1) {
    throw new Error("Could not find Iniciar/Continuar intento control");
  }

  const popupFromAttempt = context
    .waitForEvent("page", { timeout: 10000 })
    .catch(() => null);
  await attemptControl.first().click();
  await popupFromAttempt;
  await page.waitForTimeout(9000);

  const scormPage =
    context.pages().find((candidate) =>
      candidate.url().includes("/scormdriver/indexAPI.html"),
    ) || context.pages().at(-1);

  await scormPage
    .waitForLoadState("domcontentloaded", { timeout: 20000 })
    .catch(() => {});
  await scormPage.waitForTimeout(3000);
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
