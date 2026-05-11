import "dotenv/config";

import { Client } from "@notionhq/client";
import fs from "node:fs/promises";

import {
  exportScormMarkdown,
  launchPersistentContext,
} from "../scorm/markdown-exporter.mjs";
import {
  NOTION_ASSET_MANIFEST_PATH,
  SCORM_EXPORT_MANIFEST_PATH,
} from "../shared/paths.mjs";
import { formatBytes, sanitizeError } from "../shared/text.mjs";
import {
  applyCachedAssetManifest,
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
import { MULTI_PART_SIZE, uploadAssets } from "./uploads.mjs";

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

async function loadExistingExport() {
  const manifest = await readJson(SCORM_EXPORT_MANIFEST_PATH);
  const markdown = await fs.readFile(manifest.outPath, "utf8");
  return {
    ...manifest,
    markdown,
  };
}

async function getScormExport(options) {
  if (!options.refresh) {
    try {
      logProgress(`Loading cached SCORM export manifest: ${SCORM_EXPORT_MANIFEST_PATH}`);
      const scormExport = await loadExistingExport();
      logProgress(
        `Loaded Markdown export: ${
          Array.isArray(scormExport.lessons) ? scormExport.lessons.length : 0
        } lessons, ${formatBytes(scormExport.bytes)}.`,
      );
      return scormExport;
    } catch {
      logProgress(
        "Cached SCORM export is not available; opening Blackboard/SCORM to refresh it.",
      );
      // Fall through and refresh from the authenticated SCORM session.
    }
  } else {
    logProgress("Refreshing Markdown export from the authenticated SCORM session.");
  }

  const context = await launchPersistentContext();
  try {
    const scormExport = await exportScormMarkdown({
      context,
      logSummary: false,
    });
    logProgress(
      `Refreshed Markdown export: ${
        Array.isArray(scormExport.lessons) ? scormExport.lessons.length : 0
      } lessons, ${formatBytes(scormExport.bytes)}.`,
    );
    return scormExport;
  } finally {
    await context.close();
  }
}

function assertPublishConfig() {
  if (!process.env.NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY is required for --publish.");
  }
}

function assertAssetsReadyForPublish(assets) {
  const failedAssets = assets.filter((asset) => asset.status !== "downloaded");
  if (failedAssets.length > 0) {
    throw new Error(
      `Cannot publish: ${failedAssets.length} assets failed to download. First failed asset: ${
        failedAssets[0].source
      }`,
    );
  }
}

function summarize(mode, scormExport, assets, blocks, extra = {}) {
  const downloaded = assets.filter((asset) => asset.status === "downloaded");
  const failed = assets.filter((asset) => asset.status !== "downloaded");
  const images = assets.filter((asset) => asset.kind === "image");
  const videos = assets.filter((asset) => asset.kind === "video");
  const uploaded = assets.filter((asset) => asset.uploadStatus === "uploaded");
  const reusedUploads = assets.filter((asset) => asset.uploadStatus === "reused");
  const failedUploads = assets.filter((asset) => asset.uploadStatus === "upload_failed");
  const totalBytes = downloaded.reduce((sum, asset) => sum + asset.size, 0);
  const uploadChunks = downloaded.reduce(
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
    totalAssetBytes: totalBytes,
    uploadChunks,
    notionVersion: NOTION_VERSION,
    notionMediaWidthRatio: NOTION_MEDIA_WIDTH_RATIO,
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
  const cachedAssets = await applyCachedAssetManifest(assets);
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
      JSON.stringify(summarize("dry-run", scormExport, assets, blocks), null, 2),
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

  const page = await createNotionPage(notion, pageTitle, parentPage);
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
  logProgress("Publish complete.");
  console.log(JSON.stringify(summary, null, 2));
  printPublishReport(summary);
}

try {
  await main();
} catch (error) {
  console.error(sanitizeError(error));
  process.exitCode = 1;
}
