import fs from "node:fs/promises";
import path from "node:path";

import { launchPersistentContext } from "../browser/context.mjs";
import { ARTIFACTS_DIR } from "../shared/paths.mjs";
import { openScorm } from "./navigation.mjs";

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

export async function collectDebugReport(context, scormPage, artifactDir = ARTIFACTS_DIR) {
  const pages = context.pages();
  const summaries = [];
  for (let index = 0; index < pages.length; index += 1) {
    const currentPage = pages[index];
    await currentPage
      .screenshot({
        path: path.join(artifactDir, `page-${index}.png`),
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

  return {
    artifactsDir: artifactDir,
    pageCount: pages.length,
    scormPageIndex: pages.indexOf(scormPage),
    summaries,
  };
}

export async function openScormForDebug({
  artifactDir = ARTIFACTS_DIR,
  fsApi = fs,
  launchContext = launchPersistentContext,
  logger = console.log,
  openScormPage = openScorm,
} = {}) {
  await fsApi.mkdir(artifactDir, { recursive: true });
  const context = await launchContext();
  try {
    // Debugging deliberately uses the production navigation path. Keeping a
    // parallel click flow here would let diagnostics drift from the exporter.
    const scormPage = await openScormPage(context);
    const report = await collectDebugReport(context, scormPage, artifactDir);
    logger(JSON.stringify(report, null, 2));
    return report;
  } finally {
    await context.close();
  }
}
