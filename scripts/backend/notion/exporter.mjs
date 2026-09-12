import "dotenv/config";

import { Client } from "@notionhq/client";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  exportScormMarkdown,
  launchPersistentContext,
  safeFilename,
} from "../scorm/markdown-exporter.mjs";
import {
  configuredCourseOutlineUrl,
  hasNotionPaidPlan,
} from "../shared/env.mjs";
import { scormSourceIdentity } from "../scorm/urls.mjs";
import {
  EXPORT_DIR,
  NOTION_ASSET_MANIFEST_PATH,
  RAW_EXPORT_DIR,
  ROOT,
  SCORM_EXPORT_MANIFEST_PATH,
} from "../shared/paths.mjs";
import { formatBytes, sanitizeError } from "../shared/text.mjs";
import {
  applyCachedAssetManifest,
  assertAssetsReadyForPublish,
  assetMapBySource,
  collectMediaReferences,
  downloadAssets,
  readJson,
  writeAssetManifest,
} from "./assets.mjs";
import {
  countBlocksByType,
  markdownToNotionBlocks,
  NOTION_MEDIA_WIDTH_RATIO,
} from "./blocks.mjs";
import {
  appendBlocks,
  createNotionPage,
  resolveParentPage,
  trashNotionPage,
} from "./client.mjs";
import { logProgress } from "./progress.mjs";
import { jobCheckpoint } from "../shared/job-checkpoint.mjs";
import {
  markAssetsExceedingFreeLimit,
  MULTI_PART_SIZE,
  uploadAssets,
} from "./uploads.mjs";
import {
  classifyExportCache,
  promoteStagedExport,
  resolveArtifactPath,
} from "./cache.mjs";

// API contract with Notion. Bumped only when the SDK / API requires it; not a
// user-configurable knob, so this lives in code instead of `.env`.
const NOTION_VERSION = "2026-03-11";

function parseArgs(argv) {
  const args = new Set(argv);
  const dryRun = args.has("--dry-run");
  const publish = args.has("--publish");

  if (dryRun === publish) {
    throw new Error("Run with exactly one mode: --dry-run or --publish.");
  }

  return {
    dryRun,
    publish,
    refresh: args.has("--refresh"),
    deleteAfter: args.has("--delete-after"),
  };
}

async function loadExistingExport(currentSourceUrlIdentity) {
  let rawManifest;
  try {
    rawManifest = await fs.readFile(SCORM_EXPORT_MANIFEST_PATH, "utf8");
  } catch (error) {
    return {
      cache: {
        status: "unavailable",
        reason: error.code === "ENOENT" ? "manifest-missing" : "manifest-invalid",
      },
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    return {
      cache: { status: "unavailable", reason: "manifest-invalid" },
    };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      cache: { status: "unavailable", reason: "manifest-invalid" },
    };
  }
  if (!Array.isArray(manifest.lessons)) {
    return {
      cache: { status: "unavailable", reason: "manifest-invalid" },
    };
  }

  const sourceUrlIdentity = manifest.sourceUrlIdentity || "";
  const outPath = resolveArtifactPath(
    manifest.outPath,
    SCORM_EXPORT_MANIFEST_PATH,
    ROOT,
  );
  const markdownExists = outPath
    ? await fs.access(outPath).then(() => true).catch(() => false)
    : false;
  const cache = classifyExportCache({
    currentSourceUrlIdentity,
    manifest: { ...manifest, sourceUrlIdentity },
    markdownExists,
  });
  if (cache.status !== "valid") {
    return { cache };
  }

  const rawDir = resolveArtifactPath(
    manifest.rawDir,
    SCORM_EXPORT_MANIFEST_PATH,
    ROOT,
  );
  return {
    cache,
    scormExport: {
      ...manifest,
      sourceUrlIdentity,
      outPath,
      rawDir,
      exportManifestPath: SCORM_EXPORT_MANIFEST_PATH,
      lessons: (manifest.lessons || []).map((lesson) => ({
        ...lesson,
        rawTextPath: resolveArtifactPath(
          lesson.rawTextPath,
          SCORM_EXPORT_MANIFEST_PATH,
          ROOT,
        ),
        rawHtmlPath: resolveArtifactPath(
          lesson.rawHtmlPath,
          SCORM_EXPORT_MANIFEST_PATH,
          ROOT,
        ),
      })),
      markdown: await fs.readFile(outPath, "utf8"),
    },
  };
}

async function getScormExport(options) {
  const currentUrl = configuredCourseOutlineUrl();
  const currentSourceUrlIdentity = scormSourceIdentity(currentUrl);

  if (!options.refresh) {
    logProgress(`Loading cached SCORM export manifest: ${SCORM_EXPORT_MANIFEST_PATH}`);
    const cached = await loadExistingExport(currentSourceUrlIdentity);
    logProgress(`Cache status: ${cached.cache.reason}.`);
    if (cached.cache.status === "valid") {
      const scormExport = cached.scormExport;
      if (scormExport) {
        logProgress(
          `Loaded Markdown export: ${
            Array.isArray(scormExport.lessons) ? scormExport.lessons.length : 0
          } lessons, ${formatBytes(scormExport.bytes)}.`,
        );
        return scormExport;
      }
    }
    logProgress("Cached SCORM export is not available; opening Blackboard/SCORM to refresh it.");
  } else {
    logProgress("Refreshing Markdown export from the authenticated SCORM session.");
  }

  const context = await launchPersistentContext();
  const stageDir = path.join(EXPORT_DIR, ".staging", `export-${crypto.randomUUID()}`);
  const stageRawDir = path.join(stageDir, "raw");
  const stageManifestPath = path.join(stageDir, "manifest.json");
  const stageMarkdownPath = path.join(stageDir, "markdown.md");
  try {
    await fs.mkdir(stageRawDir, { recursive: true });
    const scormExport = await exportScormMarkdown({
      context,
      outPath: stageMarkdownPath,
      rawExportDir: stageRawDir,
      exportManifestPath: stageManifestPath,
      transactional: false,
      logSummary: false,
    });
    if (!Array.isArray(scormExport.lessons) || scormExport.lessons.length < 1) {
      throw new Error("SCORM export produced no lessons; staged cache was not promoted.");
    }

    const configuredOutput = (process.env.SCORM_MARKDOWN_OUT || "").trim();
    const outputPath = configuredOutput
      ? path.resolve(ROOT, configuredOutput)
      : path.join(EXPORT_DIR, `${safeFilename(scormExport.title) || "scorm-export"}.md`);
    const promoted = await promoteStagedExport(scormExport, {
      manifestPath: SCORM_EXPORT_MANIFEST_PATH,
      outputPath,
      rawDir: RAW_EXPORT_DIR,
      root: ROOT,
    });
    logProgress(
      `Refreshed Markdown export: ${
        Array.isArray(promoted.lessons) ? promoted.lessons.length : 0
      } lessons, ${formatBytes(scormExport.bytes)}.`,
    );
    return promoted;
  } finally {
    await context.close();
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

function assertPublishConfig() {
  if (!process.env.NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY is required for --publish.");
  }
}

function summarize(mode, scormExport, assets, blocks, extra = {}) {
  const downloaded = assets.filter((asset) => asset.status === "downloaded");
  const failed = assets.filter(
    (asset) =>
      asset.status !== "downloaded" && asset.uploadStatus !== "skipped_size_limit",
  );
  const images = assets.filter((asset) => asset.kind === "image");
  const videos = assets.filter((asset) => asset.kind === "video");
  const uploaded = assets.filter((asset) => asset.uploadStatus === "uploaded");
  const reusedUploads = assets.filter((asset) => asset.uploadStatus === "reused");
  const failedUploads = assets.filter((asset) => asset.uploadStatus === "upload_failed");
  const skippedUploads = assets.filter(
    (asset) => asset.uploadStatus === "skipped_size_limit",
  );
  const uploadable = downloaded.filter(
    (asset) => asset.uploadStatus !== "skipped_size_limit",
  );
  const totalBytes = uploadable.reduce((sum, asset) => sum + asset.size, 0);
  const uploadChunks = uploadable.reduce(
    (sum, asset) => sum + Math.max(1, Math.ceil(asset.size / MULTI_PART_SIZE)),
    0,
  );

  return {
    mode,
    title: scormExport.title,
    markdownPath: scormExport.outPath,
    notionAssetManifestPath: NOTION_ASSET_MANIFEST_PATH,
    lessons: Array.isArray(scormExport.lessons) ? scormExport.lessons.length : 0,
    blocks: blocks.length,
    mediaLayoutBlocks: countBlocksByType(blocks, "column_list"),
    mediaReferences: assets.reduce((sum, asset) => sum + asset.occurrences, 0),
    uniqueAssets: assets.length,
    images: images.length,
    videos: videos.length,
    downloadedAssets: downloaded.length,
    failedAssets: failed.length,
    uploadedAssets: uploaded.length,
    reusedUploads: reusedUploads.length,
    failedUploads: failedUploads.length,
    skippedUploads: skippedUploads.length,
    totalAssetBytes: totalBytes,
    uploadChunks,
    notionVersion: NOTION_VERSION,
    notionMediaWidthRatio: NOTION_MEDIA_WIDTH_RATIO,
    notionPaidPlan: hasNotionPaidPlan(),
    ...extra,
  };
}

function printPublishReport(summary) {
  console.log("\nFinal report:");
  console.log(
    `Parent page: ${summary.notionParentPageTitle || summary.notionParentPageId}`,
  );
  console.log(`Created page: ${summary.notionPageUrl}`);

  if (summary.deletedAfterValidation) {
    console.log("Status: moved to trash because --delete-after was used.");
  }
}

async function main() {
  await jobCheckpoint("worker-start");
  const options = parseArgs(process.argv.slice(2));
  logProgress(
    `Starting SCORM to Notion export in ${options.publish ? "publish" : "dry-run"} mode.`,
  );
  if (options.publish) {
    assertPublishConfig();
  }

  const scormExport = await getScormExport(options);
  const pageTitle = process.env.NOTION_PAGE_TITLE || scormExport.title;
  logProgress(`Target Notion page title: "${pageTitle}".`);
  logProgress(`Notion media width ratio: ${NOTION_MEDIA_WIDTH_RATIO}.`);
  const assets = collectMediaReferences(scormExport.markdown, scormExport.lessons);
  const mediaReferences = assets.reduce((sum, asset) => sum + asset.occurrences, 0);
  logProgress(
    `Collected ${mediaReferences} media references (${assets.length} unique assets).`,
  );
  const cachedAssets = await applyCachedAssetManifest(assets, scormExport);
  logProgress(`Restored ${cachedAssets} assets from local cache.`);

  if (assets.some((asset) => asset.absoluteUrl && asset.status !== "downloaded")) {
    const context = await launchPersistentContext();
    try {
      await downloadAssets(context, scormExport, assets);
    } finally {
      await context.close();
    }
  } else {
    await writeAssetManifest(scormExport, assets);
  }

  // If the user has not flipped the "Notion paid plan" switch we filter out
  // anything over the 5 MiB Free-tier limit before touching the API. Notion
  // would otherwise return file_upload_invalid_size mid-run and fail the job.
  if (!hasNotionPaidPlan()) {
    const skippedNow = markAssetsExceedingFreeLimit(assets);
    if (skippedNow > 0) {
      logProgress(
        `Skipped ${skippedNow} asset(s) over 5 MiB to respect the Notion Free plan limit. Enable "Tengo Notion Plus / Business / Education" in Ajustes to upload them.`,
      );
      await writeAssetManifest(scormExport, assets);
    }
  } else {
    logProgress("Notion paid plan mode: skipping pre-upload size filter.");
  }

  const assetsBySource = assetMapBySource(assets);
  logProgress("Converting Markdown to Notion blocks for validation.");
  let blocks = markdownToNotionBlocks(scormExport.markdown, assetsBySource, {
    dryRun: true,
    pageTitle,
  });
  logProgress(`Prepared ${blocks.length} Notion blocks.`);

  if (options.dryRun) {
    logProgress("Dry-run complete; no Notion page was created and no media was uploaded.");
    console.log(
      JSON.stringify(summarize("dry-run", scormExport, assets, blocks, { title: pageTitle }), null, 2),
    );
    return;
  }

  const notion = new Client({
    auth: process.env.NOTION_API_KEY,
    notionVersion: NOTION_VERSION,
  });
  logProgress("Notion client initialized.");
  const parentPage = await resolveParentPage(notion);

  assertAssetsReadyForPublish(assets);
  await uploadAssets(notion, assets, scormExport);
  logProgress("Converting Markdown to final Notion blocks with uploaded media.");
  blocks = markdownToNotionBlocks(scormExport.markdown, assetsBySource, {
    dryRun: false,
    pageTitle,
  });
  logProgress(`Prepared ${blocks.length} final Notion blocks.`);

  await jobCheckpoint("creating-page", { title: pageTitle });
  const page = await createNotionPage(notion, pageTitle, parentPage);
  await jobCheckpoint("page-created", { pageId: page.id, pageUrl: page.url, title: pageTitle });
  logProgress("Notion page created; writing page metadata to asset manifest.");
  await writeAssetManifest(scormExport, assets, {
    notionParentPageId: parentPage.id,
    notionParentPageTitle: parentPage.title,
    notionParentPageUrl: parentPage.url,
    notionParentPageSource: parentPage.source,
    notionPageId: page.id,
    notionPageUrl: page.url,
    status: "page_created",
  });

  try {
    await appendBlocks(notion, page.id, blocks);
  } catch (error) {
    if (options.deleteAfter) {
      await trashNotionPage(notion, page.id).catch((trashError) => {
        logProgress(
          `Failed to move validation page to trash after append failure: ${
            sanitizeError(trashError)
          }`,
        );
      });
    }
    throw error;
  }

  const extra = {
    title: pageTitle,
    notionParentPageId: parentPage.id,
    notionParentPageTitle: parentPage.title,
    notionParentPageUrl: parentPage.url,
    notionParentPageSource: parentPage.source,
    notionPageId: page.id,
    notionPageUrl: page.url,
  };
  if (options.deleteAfter) {
    await trashNotionPage(notion, page.id);
    extra.deletedAfterValidation = true;
  }
  await writeAssetManifest(scormExport, assets, extra);

  const summary = summarize("publish", scormExport, assets, blocks, extra);
  await jobCheckpoint("completed", { pageId: page.id, pageUrl: page.url, title: pageTitle, summary });
  logProgress("Publish complete.");
  console.log(JSON.stringify(summary, null, 2));
  printPublishReport(summary);
}

try {
  await main();
} catch (error) {
  console.error(sanitizeError(error));
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
