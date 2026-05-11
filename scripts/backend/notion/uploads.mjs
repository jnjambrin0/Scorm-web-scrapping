import fs from "node:fs/promises";
import path from "node:path";

import { formatBytes, sanitizeError } from "../shared/text.mjs";
import { assetLabel, mimeFromFilename, writeAssetManifest } from "./assets.mjs";
import { notionRequest } from "./client.mjs";
import { logProgress } from "./progress.mjs";

const SINGLE_PART_LIMIT = 20 * 1024 * 1024;
export const MULTI_PART_SIZE = 10 * 1024 * 1024;

async function uploadAsset(notion, asset, uploadedByHash, progress = {}) {
  if (asset.status !== "downloaded") {
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
    asset.uploadStatus = "upload_failed";
    asset.uploadError = sanitizeError(error);
    logProgress(`Upload failed for ${label}: ${asset.uploadError}`);
  }
}

export async function uploadAssets(notion, assets, scormExport) {
  const uploadedByHash = new Map();
  const downloadedAssets = assets.filter((asset) => asset.status === "downloaded");
  const totalBytes = downloadedAssets.reduce((sum, asset) => sum + asset.size, 0);
  const uploadChunks = downloadedAssets.reduce(
    (sum, asset) => sum + Math.max(1, Math.ceil(asset.size / MULTI_PART_SIZE)),
    0,
  );
  logProgress(
    `Uploading ${downloadedAssets.length} assets to Notion (${formatBytes(totalBytes)}, ${uploadChunks} upload chunks).`,
  );

  let uploadIndex = 0;
  for (const asset of assets) {
    if (asset.status === "downloaded") {
      uploadIndex += 1;
    }
    await uploadAsset(notion, asset, uploadedByHash, {
      index: uploadIndex,
      total: downloadedAssets.length,
    });
    await writeAssetManifest(scormExport, assets);
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
