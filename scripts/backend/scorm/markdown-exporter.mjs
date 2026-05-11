import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchPersistentContext } from "../browser/context.mjs";
import { configuredCourseOutlineUrl, resolveExportTitle } from "../shared/env.mjs";
import {
  EXPORT_DIR,
  NOTION_ASSET_DIR,
  RAW_EXPORT_DIR,
  SCORM_EXPORT_MANIFEST_PATH as EXPORT_MANIFEST_PATH,
} from "../shared/paths.mjs";
import { safeFilename } from "../shared/text.mjs";
import { activateNonNavigationControls, scrollWholeLesson } from "./lesson-actions.mjs";
import { openScorm, waitForFrame } from "./navigation.mjs";
import { readOverview, readScormPageTitle } from "./overview.mjs";
import { renderRiseLessonInBrowser } from "./rise-renderer.mjs";

export { launchPersistentContext, safeFilename };
export { openScorm, readOverview, waitForFrame };

const OUT_PATH = process.env.SCORM_MARKDOWN_OUT || null;

function defaultMarkdownOutPath(title) {
  return path.join(EXPORT_DIR, `${safeFilename(title) || "scorm-export"}.md`);
}

export async function readLessonMarkdown(frame, lesson) {
  await frame.evaluate((href) => {
    location.hash = href;
  }, lesson.href);

  await frame.waitForSelector(".lesson-header__title", { timeout: 20000 });
  await frame.page().waitForTimeout(2500);
  await scrollWholeLesson(frame);
  await activateNonNavigationControls(frame);
  await scrollWholeLesson(frame);

  return frame.evaluate(renderRiseLessonInBrowser);
}
export function dedupeBlankLines(markdown) {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function postProcessMarkdown(markdown) {
  const fillerLines = new Set(["¡Comenzamos!", "¡Vamos allá!", "START"]);
  const withoutFiller = markdown
    .split("\n")
    .filter((line) => !fillerLines.has(line.trim()))
    .join("\n");

  return withoutFiller.replace(
    /(^# .+\n)(?:\s*\n)*## Introducción\n+/gm,
    "$1\n",
  );
}

export async function exportScormMarkdown(options = {}) {
  const {
    context: providedContext,
    outPath = OUT_PATH,
    rawExportDir = RAW_EXPORT_DIR,
    exportManifestPath = EXPORT_MANIFEST_PATH,
    logSummary = true,
  } = options;
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  await fs.mkdir(rawExportDir, { recursive: true });

  const context = providedContext || (await launchPersistentContext());
  try {
    const scormPage = await openScorm(context);
    const frame = waitForFrame(scormPage);

    const overview = await readOverview(frame);
    if (overview.length === 0) {
      throw new Error("Could not read SCORM overview");
    }
    const exportTitle = resolveExportTitle(await readScormPageTitle(frame));
    const outputPath = outPath || defaultMarkdownOutPath(exportTitle);

    const parts = [`# ${exportTitle}`];
    let lessonCount = 0;
    const lessons = [];

    for (const section of overview) {
      parts.push(`# ${section.title}`);

      for (const lesson of section.lessons) {
        const lessonMarkdown = await readLessonMarkdown(frame, lesson);
        lessonCount += 1;

        const rawBase = `${String(lessonCount).padStart(2, "0")}-${safeFilename(
          `${section.title}-${lesson.title}`,
        )}`;
        const rawTextPath = path.join(rawExportDir, `${rawBase}.txt`);
        const rawHtmlPath = path.join(rawExportDir, `${rawBase}.html`);
        await fs.writeFile(
          rawTextPath,
          lessonMarkdown.rawText,
          "utf8",
        );
        await fs.writeFile(
          rawHtmlPath,
          lessonMarkdown.rawHtml,
          "utf8",
        );
        lessons.push({
          index: lessonCount,
          sectionTitle: section.title,
          lessonTitle: lesson.title,
          href: lesson.href,
          hash: lessonMarkdown.hash,
          baseUri: lessonMarkdown.baseUri,
          url: lessonMarkdown.url,
          rawTextPath,
          rawHtmlPath,
          markdownBytes: Buffer.byteLength(lessonMarkdown.markdown, "utf8"),
          textLength: lessonMarkdown.textLength,
        });

        parts.push(`## ${lesson.title}`);
        if (lessonMarkdown.markdown) {
          parts.push(lessonMarkdown.markdown);
        }
      }
    }

    const markdown = `${dedupeBlankLines(
      postProcessMarkdown(parts.join("\n\n")),
    )}\n`;
    await fs.writeFile(outputPath, markdown, "utf8");

    const summary = {
      title: exportTitle,
      courseOutlineUrl: configuredCourseOutlineUrl(),
      outPath: outputPath,
      rawDir: rawExportDir,
      exportManifestPath,
      sections: overview.length,
      lessons: lessonCount,
      bytes: Buffer.byteLength(markdown, "utf8"),
    };
    const manifest = {
      ...summary,
      lessons,
    };
    await fs.writeFile(exportManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (logSummary) {
      console.log(JSON.stringify(summary, null, 2));
    }

    return {
      ...manifest,
      markdown,
    };
  } finally {
    if (!providedContext) {
      await context.close();
    }
  }
}

/**
 * Wipe the on-disk SCORM export cache so the next run starts from scratch.
 * Called when the current job targets a different `COURSE_OUTLINE_URL` than
 * the cached manifest, or when the user explicitly passes `--refresh`. Silent
 * by design — the caller logs once after invoking it.
 */
export async function clearScormExportCache() {
  let cachedOutPath = null;
  try {
    const manifest = JSON.parse(await fs.readFile(EXPORT_MANIFEST_PATH, "utf8"));
    if (typeof manifest.outPath === "string" && manifest.outPath) {
      cachedOutPath = manifest.outPath;
    }
  } catch {
    // No manifest, or unreadable — nothing more to discover.
  }

  await Promise.all([
    fs.rm(EXPORT_MANIFEST_PATH, { force: true }),
    fs.rm(NOTION_ASSET_DIR, { recursive: true, force: true }),
    cachedOutPath ? fs.rm(cachedOutPath, { force: true }) : Promise.resolve(),
  ]);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await exportScormMarkdown();
}
