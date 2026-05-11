import fs from "node:fs/promises";
import path from "node:path";

import { NOTION_FREE_TIER_FILE_LIMIT } from "../shared/env.mjs";
import { formatBytes, sanitizeError } from "../shared/text.mjs";
import { assetLabel, mimeFromFilename, writeAssetManifest } from "./assets.mjs";
import { notionRequest } from "./client.mjs";
import { logProgress } from "./progress.mjs";

const SINGLE_PART_LIMIT = 20 * 1024 * 1024;
export const MULTI_PART_SIZE = 10 * 1024 * 1024;

// Notion surfaces this specific code on the file_upload object when the file
// exceeds the workspace's `max_file_upload_size_in_bytes`. The free tier hits
// it for anything over 5 MiB. We treat it as an actionable, distinguishable
// failure so the UI can show the right hint (toggle the paid-plan switch,
// or upgrade to Plus / Business / Education).
const NOTION_FILE_SIZE_ERROR_CODE = "file_upload_invalid_size";
const NOTION_FILE_SIZE_ERROR_PATTERN =
  /file size is not within the allowed limit of \d+\s*(MiB|GiB|MB|GB)/i;

function isNotionFileSizeError(error) {
  const code = error?.code || error?.body?.code || "";
  if (code === NOTION_FILE_SIZE_ERROR_CODE) return true;
  const message = error?.message || error?.body?.message || "";
  return NOTION_FILE_SIZE_ERROR_PATTERN.test(message);
}

/**
 * Mark every downloaded asset whose size exceeds Notion's Free tier limit so
 * the rest of the pipeline (upload, block rendering, summary) can short-
 * circuit on it. Returns the number of assets that were just marked. Idempotent
 * — assets already flagged are left as-is.
 */
export function markAssetsExceedingFreeLimit(assets) {
  let count = 0;
  for (const asset of assets) {
    if (asset.status !== "downloaded") continue;
    if (asset.uploadStatus === "skipped_size_limit") continue;
    if (typeof asset.size !== "number" || asset.size <= NOTION_FREE_TIER_FILE_LIMIT) continue;
    asset.uploadStatus = "skipped_size_limit";
    count += 1;
  }
  return count;
}

async function uploadAsset(notion, asset, uploadedByHash, progress = {}) {
  if (asset.status !== "downloaded") {
    return;
  }
  if (asset.uploadStatus === "skipped_size_limit") {
    logProgress(
      `Skipping ${assetLabel(asset)} (${formatBytes(asset.size)} > 5 MiB Free plan limit).`,
    );
    return;
  }

  const progressLabel = progress.index && progress.total
    ? `${progress.index}/${progress.total}`
    : String(asset.id);
  const label = assetLabel(asset);
  const duplicate = uploadedByHash.get(asset.sha256);
  if (duplicate) {
    asset.fileUploadId = duplicate.fileUploadId;
    asset.uploadStatus = "reused";
    logProgress(
      `Reusing Notion upload ${progressLabel}: ${label} duplicates asset ${duplicate.id}.`,
    );
    return;
  }

  const buffer = await fs.readFile(asset.localPath);
  const filename = path.basename(asset.localPath);
  const contentType = asset.mime || mimeFromFilename(filename);

  try {
    if (asset.size <= SINGLE_PART_LIMIT) {
      logProgress(
        `Uploading asset ${progressLabel}: ${label} (${contentType}, ${formatBytes(asset.size)}, single_part).`,
      );
      const upload = await notionRequest(() =>
        notion.fileUploads.create({
          mode: "single_part",
          filename,
          content_type: contentType,
        }),
      );
      await notionRequest(() =>
        notion.fileUploads.send({
          file_upload_id: upload.id,
          file: {
            filename,
            data: new Blob([buffer], { type: contentType }),
          },
        }),
      );
      asset.fileUploadId = upload.id;
    } else {
      const numberOfParts = Math.ceil(asset.size / MULTI_PART_SIZE);
      logProgress(
        `Uploading asset ${progressLabel}: ${label} (${contentType}, ${formatBytes(asset.size)}, multi_part ${numberOfParts} parts).`,
      );
      const upload = await notionRequest(() =>
        notion.fileUploads.create({
          mode: "multi_part",
          filename,
          content_type: contentType,
          number_of_parts: numberOfParts,
        }),
      );

      for (let partIndex = 0; partIndex < numberOfParts; partIndex += 1) {
        const start = partIndex * MULTI_PART_SIZE;
        const end = Math.min(start + MULTI_PART_SIZE, buffer.byteLength);
        const part = buffer.subarray(start, end);
        logProgress(
          `Sending upload part ${partIndex + 1}/${numberOfParts} for ${label} (${formatBytes(part.byteLength)}).`,
        );
        await notionRequest(() =>
          notion.fileUploads.send({
            file_upload_id: upload.id,
            part_number: String(partIndex + 1),
            file: {
              filename,
              data: new Blob([part], { type: contentType }),
            },
          }),
        );
      }

      await notionRequest(() =>
        notion.fileUploads.complete({
          file_upload_id: upload.id,
        }),
      );
      asset.fileUploadId = upload.id;
    }

    asset.uploadStatus = "uploaded";
    uploadedByHash.set(asset.sha256, asset);
    logProgress(`Uploaded asset ${progressLabel}: ${label}.`);
  } catch (error) {
    asset.uploadError = sanitizeError(error);
    if (isNotionFileSizeError(error)) {
      asset.uploadStatus = "free_tier_rejected";
      logProgress(
        `Notion rejected ${label} (${formatBytes(asset.size)}) for exceeding the workspace file-size limit. The "Notion paid plan" switch is enabled but the workspace seems to be on Free.`,
      );
    } else {
      asset.uploadStatus = "upload_failed";
      logProgress(`Upload failed for ${label}: ${asset.uploadError}`);
    }
  }
}

export async function uploadAssets(notion, assets, scormExport) {
  const uploadedByHash = new Map();
  const uploadableAssets = assets.filter(
    (asset) =>
      asset.status === "downloaded" && asset.uploadStatus !== "skipped_size_limit",
  );
  const totalBytes = uploadableAssets.reduce((sum, asset) => sum + asset.size, 0);
  const uploadChunks = uploadableAssets.reduce(
    (sum, asset) => sum + Math.max(1, Math.ceil(asset.size / MULTI_PART_SIZE)),
    0,
  );
  logProgress(
    `Uploading ${uploadableAssets.length} assets to Notion (${formatBytes(totalBytes)}, ${uploadChunks} upload chunks).`,
  );

  let uploadIndex = 0;
  for (const asset of assets) {
    if (asset.status === "downloaded" && asset.uploadStatus !== "skipped_size_limit") {
      uploadIndex += 1;
    }
    await uploadAsset(notion, asset, uploadedByHash, {
      index: uploadIndex,
      total: uploadableAssets.length,
    });
    await writeAssetManifest(scormExport, assets);
  }

  const rejectedByFreeTier = assets.filter(
    (asset) => asset.uploadStatus === "free_tier_rejected",
  );
  if (rejectedByFreeTier.length > 0) {
    // Surface this as a recognisable signal so the frontend error classifier
    // can route the user to the actionable hint (toggle the switch / upgrade).
    throw new Error(
      `Notion rejected ${rejectedByFreeTier.length} file(s) with file_upload_invalid_size: file size is not within the allowed limit of 5 MiB. Your workspace looks Free but the paid-plan switch is on.`,
    );
  }

  const failedUploads = assets.filter(
    (asset) => asset.status === "downloaded" && asset.uploadStatus === "upload_failed",
  );
  if (failedUploads.length > 0) {
    throw new Error(
      `Notion upload failed for ${failedUploads.length} assets. First error: ${
        failedUploads[0].uploadError || "unknown"
      }`,
    );
  }
  logProgress("Finished uploading assets to Notion.");
}
