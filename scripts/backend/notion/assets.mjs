import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { openScorm } from "../scorm/navigation.mjs";
import { downloadAssetFromPlayer, safeAssetRoute } from "./asset-download.mjs";
import { scormSourceIdentity } from "../scorm/urls.mjs";
import {
  NOTION_ASSET_DIR,
  NOTION_ASSET_MANIFEST_PATH,
  ROOT,
} from "../shared/paths.mjs";
import { formatBytes, safeFilename } from "../shared/text.mjs";
import { logProgress } from "./progress.mjs";

const NOTION_ASSET_MANIFEST_SCHEMA_VERSION = 2;

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

function manifestPath(value) {
  const relative = path.relative(ROOT, path.resolve(value));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.resolve(value);
  }
  return relative.split(path.sep).join("/");
}

export async function writeAssetManifest(scormExport, assets, extra = {}) {
  await fs.mkdir(NOTION_ASSET_DIR, { recursive: true });
  const manifest = {
    schemaVersion: NOTION_ASSET_MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceMarkdown: manifestPath(scormExport.outPath),
    sourceManifest: manifestPath(scormExport.exportManifestPath),
    sourceUrlIdentity:
      scormExport.sourceUrlIdentity || scormSourceIdentity(scormExport.courseOutlineUrl || ""),
    title: scormExport.title,
    assets,
    ...extra,
  };
  const temporary = `${NOTION_ASSET_MANIFEST_PATH}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
      await file.sync();
    } finally { await file.close(); }
    await fs.rename(temporary, NOTION_ASSET_MANIFEST_PATH);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function applyCachedAssetManifest(assets, scormExport) {
  let manifest;
  try {
    manifest = await readJson(NOTION_ASSET_MANIFEST_PATH);
  } catch {
    return 0;
  }
  // Defensive: refuse to reuse an asset manifest that was generated for a
  // different Markdown export. The exporter wipes the asset directory on URL
  // mismatch, but if anything leaks through (corrupted state, hand-edited
  // manifest) this prevents cross-URL contamination of media references.
  if (scormExport?.sourceUrlIdentity) {
    // Legacy asset manifests have no trustworthy source identity. Their
    // sourceManifest path may now point at a newer export, so refusing reuse
    // is safer than risking cross-course media contamination.
    if (
      manifest.schemaVersion !== NOTION_ASSET_MANIFEST_SCHEMA_VERSION ||
      manifest.sourceUrlIdentity !== scormExport.sourceUrlIdentity
    ) {
      return 0;
    }
  } else if (
    typeof manifest.sourceMarkdown === "string" &&
    manifest.sourceMarkdown &&
    scormExport?.outPath &&
    manifest.sourceMarkdown !== scormExport.outPath
  ) {
    return 0;
  }
  const cachedAssets = manifest.assets || [];
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

    const localPath = path.isAbsolute(cached.localPath) ? cached.localPath : path.resolve(ROOT, cached.localPath);
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isFile() || stat.size === 0 || stat.size !== cached.size) {
      continue;
    }

    asset.mime = cached.mime;
    asset.size = cached.size;
    asset.sha256 = cached.sha256;
    asset.localPath = localPath;
    asset.statusCode = cached.statusCode;
    asset.finalUrl = safeAssetRoute(cached.finalUrl);
    asset.status = "downloaded";
    asset.duplicateOf = cached.duplicateOf;
    restoredAssets += 1;
  }

  return restoredAssets;
}

export async function downloadAssets(context, scormExport, assets, {
  assetDir = NOTION_ASSET_DIR,
  openPlayer = openScorm,
  saveManifest = writeAssetManifest,
  downloadOptions,
} = {}) {
  await fs.mkdir(assetDir, { recursive: true });
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

  const player = needsDownload ? await openPlayer(context) : null;

  let pendingIndex = 0;
  for (const asset of assets) {
    if (!asset.absoluteUrl || asset.status === "downloaded") {
      continue;
    }
    pendingIndex += 1;
    const label = assetLabel(asset);
    let stopError = null;
    delete asset.error;
    delete asset.statusCode;
    delete asset.finalUrl;

    try {
      logProgress(
        `Downloading asset ${pendingIndex}/${pendingAssets.length}: ${label} (${asset.kind}).`,
      );
      const response = await downloadAssetFromPlayer(player, asset, downloadOptions);
      asset.statusCode = response.status;
      asset.finalUrl = response.finalUrl;
      asset.diagnostic = response.diagnostic;
      if (!response.ok) {
        asset.status = "download_failed";
        asset.error = `${response.diagnostic.category}${response.status ? `; HTTP ${response.status}` : ""}; attempts ${response.diagnostic.attempts.length}`;
        logProgress(`Download failed for ${label}: ${asset.error}.`);
        logProgress(`Asset download diagnostic: ${JSON.stringify(asset.diagnostic)}`);
        if (response.diagnostic.category === "session-required") {
          stopError = new Error(`SESSION_INVALID: Blackboard session expired while downloading ${label}.`);
        } else if (["browser-closed", "content-not-ready", "content-ambiguous"].includes(response.diagnostic.category)) {
          stopError = new Error(`SCORM asset download stopped: ${response.diagnostic.category}; ${label}.`);
        }
      } else {
        asset.mime = response.mime || mimeFromFilename(asset.source);
        const buffer = Buffer.from(response.base64, "base64");
        const localPath = path.join(assetDir, localNameForAsset(asset));
        const temporary = `${localPath}.${crypto.randomUUID()}.part`;
        try {
          await fs.writeFile(temporary, buffer);
          await fs.rename(temporary, localPath);
        } finally { await fs.unlink(temporary).catch(() => {}); }
        asset.size = buffer.byteLength;
        asset.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        asset.localPath = localPath;
        asset.status = "downloaded";
        logProgress(`Downloaded asset ${pendingIndex}/${pendingAssets.length}: ${label} (${asset.mime}, ${formatBytes(asset.size)}).`);
      }
    } catch (error) {
      asset.status = "download_failed";
      asset.error = `local-write-failed: ${error.code || "unknown"}`;
      asset.diagnostic = { ...asset.diagnostic, category: "local-write-failed" };
      logProgress(`Download failed for ${label}: ${asset.error}`);
      stopError = new Error(`SCORM asset could not be saved locally: ${label}; ${error.code || "unknown"}.`);
    }
    await saveManifest(scormExport, assets);
    if (stopError) throw stopError;
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

  await saveManifest(scormExport, assets);
  logProgress(`Asset manifest written: ${NOTION_ASSET_MANIFEST_PATH}`);
  return assets;
}

export function assertAssetsReadyForPublish(assets) {
  const failed = assets.filter((asset) => asset.status !== "downloaded" && asset.uploadStatus !== "skipped_size_limit");
  if (!failed.length) return;
  const details = failed.slice(0, 5).map((asset) => `${assetLabel(asset)} [${asset.error || asset.diagnostic?.category || asset.status}]`);
  throw new Error(`Cannot publish: ${failed.length} assets failed to download. ${details.join("; ")}${failed.length > 5 ? "; see asset manifest for remaining failures" : ""}.`);
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
