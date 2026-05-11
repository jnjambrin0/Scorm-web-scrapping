import fs from "node:fs/promises";
import path from "node:path";

import { launchPersistentContext } from "../browser/context.mjs";
import {
  configuredCourseOutlineUrl,
  configuredScormTitle,
  isDirectScormUrl,
} from "../shared/env.mjs";
import { ARTIFACTS_DIR } from "../shared/paths.mjs";

async function textSnippet(page, timeout = 7000) {
  try {
    return (await page.locator("body").innerText({ timeout })).slice(0, 3000);
  } catch {
    return "";
  }
}

async function frameSummaries(page) {
  return Promise.all(
    page.frames().map(async (frame) => {
      let text = "";
      try {
        text = await frame.locator("body").innerText({ timeout: 2500 });
      } catch {
        text = "";
      }

      return {
        name: frame.name(),
        url: frame.url(),
        text: text.slice(0, 1500),
      };
    }),
  );
}

export async function openScormForDebug() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  const courseOutlineUrl = configuredCourseOutlineUrl();
  if (!courseOutlineUrl) {
    throw new Error(
      "COURSE_OUTLINE_URL is empty. Set it via the form or as an env override before debugging.",
    );
  }
  const scormTitle = configuredScormTitle();
  if (!isDirectScormUrl(courseOutlineUrl) && !scormTitle) {
    throw new Error(
      "SCORM_TITLE is empty. When the URL points to an outline, the unit title is required.",
    );
  }
  const context = await launchPersistentContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(courseOutlineUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  if (!isDirectScormUrl(courseOutlineUrl)) {
    const unitHeader = page.getByText(scormTitle, { exact: true });
    if ((await unitHeader.count()) < 1) {
      throw new Error(`Could not find unit header: ${scormTitle}`);
    }

    await unitHeader.first().click();
    await page.waitForTimeout(1500);

    const scormItem = page.locator("a").filter({ hasText: scormTitle });
    if ((await scormItem.count()) < 1) {
      throw new Error(`Could not find SCORM item link: ${scormTitle}`);
    }

    await scormItem.first().click();
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  const attemptControl = page.getByText(
    /Continuar intento\s*\d*|Iniciar intento\s*\d*/i,
  );
  const attemptCount = await attemptControl.count();
  if (attemptCount < 1) {
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, "no-attempt-control.png"),
      fullPage: true,
    });
    throw new Error("Could not find Iniciar/Continuar intento control");
  }

  const popupFromAttempt = context.waitForEvent("page", { timeout: 10000 }).catch(
    () => null,
  );
  await attemptControl.first().click();
  const attemptPopup = await popupFromAttempt;

  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(
    () => {},
  );
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const openCourseControl = page.getByText(/Abrir curso/i);
  let openCoursePopup = null;
  if ((await openCourseControl.count()) > 0) {
    const popupFromOpen = context
      .waitForEvent("page", { timeout: 15000 })
      .catch(() => null);
    await openCourseControl.first().click();
    openCoursePopup = await popupFromOpen;
  }

  const popupCandidates = [attemptPopup, openCoursePopup].filter(Boolean);
  await Promise.all(
    popupCandidates.map(async (popup) => {
      await popup
        .waitForLoadState("domcontentloaded", { timeout: 20000 })
        .catch(() => {});
      await popup
        .waitForLoadState("networkidle", { timeout: 20000 })
        .catch(() => {});
    }),
  );

  await page.waitForTimeout(5000);

  const pages = context.pages();
  const summaries = [];
  for (let index = 0; index < pages.length; index += 1) {
    const currentPage = pages[index];
    await currentPage
      .screenshot({
        path: path.join(ARTIFACTS_DIR, `page-${index}.png`),
        fullPage: false,
      })
      .catch(() => {});

    summaries.push({
      index,
      title: await currentPage.title().catch(() => ""),
      url: currentPage.url(),
      text: await textSnippet(currentPage),
      frames: await frameSummaries(currentPage),
    });
  }

  console.log(
    JSON.stringify(
      {
        artifactsDir: ARTIFACTS_DIR,
        pageCount: pages.length,
        attemptPopupIndex: attemptPopup ? pages.indexOf(attemptPopup) : null,
        openCoursePopupIndex: openCoursePopup
          ? pages.indexOf(openCoursePopup)
          : null,
        summaries,
      },
      null,
      2,
    ),
  );

  await context.close();
}
