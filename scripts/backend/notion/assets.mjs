import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { openScorm, waitForFrame } from "../scorm/navigation.mjs";
import { NOTION_ASSET_DIR, NOTION_ASSET_MANIFEST_PATH } from "../shared/paths.mjs";
import { formatBytes, safeFilename, sanitizeError } from "../shared/text.mjs";
import { logProgress } from "./progress.mjs";

export function assetLabel(asset) {
  return path.basename(asset.source.split("?")[0]) || `asset-${asset.id}`;
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function mediaTypeFromSource(source, explicitType) {
  if (explicitType) {
    return explicitType;
  }

  const pathname = source.split("?")[0].toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi|mkv|wmv|flv|mpeg|mpg)$/.test(pathname)) {
    return "video";
  }

  return "image";
}

function resolveAssetUrl(source, baseUri) {
  if (!baseUri) {
    return null;
  }

  try {
    return new URL(source, baseUri).href;
  } catch {
    return null;
  }
}

export function collectMediaReferences(markdown, lessons) {
  const lessonsByHeading = new Map(
    lessons.map((lesson) => [
      `${lesson.sectionTitle}\u0000${lesson.lessonTitle}`,
      lesson,
    ]),
  );
  const defaultBaseUri = lessons[0]?.baseUri || null;
  const assetsByUrl = new Map();
  const orderedAssets = [];
  let currentSection = "";
  let currentBaseUri = defaultBaseUri;

  const addReference = ({ source, alt = "", kind, lineNumber }) => {
    if (!source || !source.startsWith("assets/")) {
      return;
    }

    const absoluteUrl = resolveAssetUrl(source, currentBaseUri);
    const key = absoluteUrl || `unresolved:${source}`;
    let asset = assetsByUrl.get(key);
    if (!asset) {
      asset = {
        id: orderedAssets.length + 1,
        source,
        absoluteUrl,
        kind: mediaTypeFromSource(source, kind),
        alt,
        occurrences: 0,
        lines: [],
        status: absoluteUrl ? "pending" : "missing_base_uri",
      };
      assetsByUrl.set(key, asset);
      orderedAssets.push(asset);
    }

    asset.occurrences += 1;
    asset.lines.push(lineNumber);
  };

  markdown.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const sectionMatch = line.match(/^# (.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      return;
    }

    const lessonMatch = line.match(/^## (.+)$/);
    if (lessonMatch) {
      const lesson = lessonsByHeading.get(
        `${currentSection}\u0000${lessonMatch[1].trim()}`,
      );
      currentBaseUri = lesson?.baseUri || currentBaseUri || defaultBaseUri;
      return;
    }

    for (const match of line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      addReference({
        source: match[2].trim(),
        alt: match[1].trim(),
        kind: "image",
        lineNumber,
      });
    }

    for (const match of line.matchAll(/\[video\]\(([^)]+)\)/g)) {
      addReference({
        source: match[1].trim(),
        kind: "video",
        lineNumber,
      });
    }
  });

  return orderedAssets;
}

function extensionFromMime(mime) {
  const cleanMime = mime?.split(";")[0].trim().toLowerCase();
  const extensions = new Map([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"],
    ["image/svg+xml", ".svg"],
    ["video/mp4", ".mp4"],
    ["video/quicktime", ".mov"],
    ["video/webm", ".webm"],
    ["application/pdf", ".pdf"],
  ]);
  return extensions.get(cleanMime) || "";
}

export function mimeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimes = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
    [".mp4", "video/mp4"],
    [".mov", "video/quicktime"],
    [".m4v", "video/mp4"],
    [".webm", "video/webm"],
    [".pdf", "application/pdf"],
  ]);
  return mimes.get(ext) || "application/octet-stream";
}

function isExpectedAssetMime(asset, mime) {
  const cleanMime = mime?.split(";")[0].trim().toLowerCase() || "";
  if (!cleanMime || cleanMime === "text/html") {
    return false;
  }

  if (asset.kind === "image") {
    return cleanMime.startsWith("image/") || cleanMime === "application/octet-stream";
  }

  if (asset.kind === "video") {
    return cleanMime.startsWith("video/") || cleanMime === "application/octet-stream";
  }

  return true;
}

function localNameForAsset(asset) {
  const parsed = new URL(asset.absoluteUrl);
  const sourceName = decodeURIComponent(path.posix.basename(parsed.pathname));
  const sourceExt = path.posix.extname(sourceName);
  const ext = sourceExt || extensionFromMime(asset.mime) || "";
  const stem = safeFilename(
    sourceExt ? sourceName.slice(0, -sourceExt.length) : sourceName,
  );
  return `${String(asset.id).padStart(3, "0")}-${stem || "asset"}${ext}`;
}

export async function writeAssetManifest(scormExport, assets, extra = {}) {
  await fs.mkdir(NOTION_ASSET_DIR, { recursive: true });
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceMarkdown: scormExport.outPath,
    sourceManifest: scormExport.exportManifestPath,
    title: scormExport.title,
    assets,
    ...extra,
  };
  await fs.writeFile(
    NOTION_ASSET_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function applyCachedAssetManifest(assets) {
  let cachedAssets = [];
  try {
    cachedAssets = (await readJson(NOTION_ASSET_MANIFEST_PATH)).assets || [];
  } catch {
    return 0;
  }
  let restoredAssets = 0;

  const cachedByUrl = new Map(
    cachedAssets
      .filter((asset) => asset.absoluteUrl)
      .map((asset) => [asset.absoluteUrl, asset]),
  );

  for (const asset of assets) {
    const cached = cachedByUrl.get(asset.absoluteUrl);
    if (!cached || cached.status !== "downloaded" || !cached.localPath) {
      continue;
    }

    if (!isExpectedAssetMime(asset, cached.mime)) {
      continue;
    }

    if (!(await fileExists(cached.localPath))) {
      continue;
    }

    asset.mime = cached.mime;
    asset.size = cached.size;
    asset.sha256 = cached.sha256;
    asset.localPath = cached.localPath;
    asset.statusCode = cached.statusCode;
    asset.status = "downloaded";
    asset.duplicateOf = cached.duplicateOf;
    restoredAssets += 1;
  }

  return restoredAssets;
}

export async function downloadAssets(context, scormExport, assets) {
  await fs.mkdir(NOTION_ASSET_DIR, { recursive: true });
  const pendingAssets = assets.filter(
    (asset) => asset.absoluteUrl && asset.status !== "downloaded",
  );
  const needsDownload = pendingAssets.length > 0;
  if (!needsDownload) {
    logProgress("All SCORM assets are already available in the local cache.");
  } else {
    logProgress(
      `Downloading ${pendingAssets.length} SCORM assets through the authenticated SCORM frame.`,
    );
  }

  const frame = needsDownload ? waitForFrame(await openScorm(context)) : null;
  if (frame) {
    logProgress("SCORM frame is ready for authenticated asset downloads.");
  }

  let pendingIndex = 0;
  for (const asset of assets) {
    if (!asset.absoluteUrl || asset.status === "downloaded") {
      continue;
    }
    pendingIndex += 1;
    const label = assetLabel(asset);

    try {
      logProgress(
        `Downloading asset ${pendingIndex}/${pendingAssets.length}: ${label} (${asset.kind}).`,
      );
      const response = await frame.evaluate(async (source) => {
        const assetResponse = await fetch(source, { credentials: "include" });
        const buffer = await assetResponse.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }

        return {
          ok: assetResponse.ok,
          status: assetResponse.status,
          url: assetResponse.url,
          mime: assetResponse.headers.get("content-type") || "",
          base64: btoa(binary),
        };
      }, asset.source);

      asset.statusCode = response.status;
      asset.finalUrl = response.url;
      if (!response.ok) {
        asset.status = "download_failed";
        logProgress(
          `Download failed for ${label}: HTTP ${response.status}.`,
        );
        continue;
      }

      asset.mime = response.mime.split(";")[0].trim() || mimeFromFilename(asset.source);
      if (!isExpectedAssetMime(asset, asset.mime)) {
        asset.status = "download_failed";
        asset.error = `Unexpected MIME type: ${asset.mime}`;
        logProgress(
          `Download failed for ${label}: unexpected MIME type ${asset.mime}.`,
        );
        continue;
      }

      const buffer = Buffer.from(response.base64, "base64");
      asset.size = buffer.byteLength;
      asset.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      asset.localPath = path.join(NOTION_ASSET_DIR, localNameForAsset(asset));
      await fs.writeFile(asset.localPath, buffer);
      asset.status = "downloaded";
      logProgress(
        `Downloaded asset ${pendingIndex}/${pendingAssets.length}: ${label} (${asset.mime}, ${formatBytes(asset.size)}).`,
      );
    } catch (error) {
      asset.status = "download_failed";
      asset.error = sanitizeError(error);
      logProgress(`Download failed for ${label}: ${asset.error}`);
    }
  }

  const firstUploadByHash = new Map();
  for (const asset of assets) {
    if (asset.status !== "downloaded") {
      continue;
    }

    const existing = firstUploadByHash.get(asset.sha256);
    if (existing) {
      asset.duplicateOf = existing.id;
    } else {
      firstUploadByHash.set(asset.sha256, asset);
    }
  }

  await writeAssetManifest(scormExport, assets);
  logProgress(`Asset manifest written: ${NOTION_ASSET_MANIFEST_PATH}`);
  return assets;
}

export function assetMapBySource(assets) {
  const result = new Map();
  for (const asset of assets) {
    if (!result.has(asset.source)) {
      result.set(asset.source, asset);
    }
  }
  return result;
}
