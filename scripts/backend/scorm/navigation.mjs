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

async function dismissConcurrentSessionModal(page) {
  const closeButton = page.locator(
    '#concurrent-session-bbmodal button[aria-label="Cerrar"]',
  );
  if ((await closeButton.count().catch(() => 0)) > 0) {
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
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
