import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SCORM_EXPORT_MANIFEST_SCHEMA_VERSION = 2;

function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function manifestPathValue(value, root) {
  if (typeof value !== "string" || !value) return null;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function manifestRelativePath(value, root) {
  const relative = path.relative(root, path.resolve(value));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.resolve(value);
  }
  return relative.split(path.sep).join("/");
}

function remapStagedPath(value, stagedRawDir, stableRawDir) {
  if (typeof value !== "string" || !value) return value;
  const relative = path.relative(stagedRawDir, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return path.join(stableRawDir, relative);
  }
  return value;
}

export function classifyExportCache({
  currentSourceUrlIdentity,
  manifest,
  markdownExists = false,
}) {
  if (manifest === undefined) {
    return { status: "unavailable", reason: "manifest-missing" };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { status: "unavailable", reason: "manifest-invalid" };
  }
  if (!Array.isArray(manifest.lessons) || manifest.lessons.length < 1) {
    return { status: "unavailable", reason: "manifest-invalid" };
  }
  if (manifest.schemaVersion !== SCORM_EXPORT_MANIFEST_SCHEMA_VERSION) {
    return { status: "unavailable", reason: "source-schema-migration" };
  }

  if (
    !currentSourceUrlIdentity ||
    manifest.sourceUrlIdentity !== currentSourceUrlIdentity
  ) {
    return { status: "unavailable", reason: "source-mismatch" };
  }

  if (!markdownExists) {
    return { status: "unavailable", reason: "markdown-missing" };
  }

  return { status: "valid", reason: "valid" };
}

export function resolveArtifactPath(value, manifestPath, root) {
  if (typeof value !== "string" || !value) return null;
  if (path.isAbsolute(value)) return value;
  if (value.startsWith("exports/") || value.startsWith("artifacts/")) {
    return path.resolve(root, value);
  }
  return path.resolve(path.dirname(manifestPath), value);
}

export async function promoteStagedExport(
  stagedExport,
  { manifestPath, outputPath, rawDir, root },
) {
  const backupRoot = path.join(
    root,
    ".staging",
    `backup-${crypto.randomUUID()}`,
  );
  const oldManifest = await fs
    .readFile(manifestPath, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => null);
  const oldPaths = [
    manifestPath,
    outputPath,
    rawDir,
    manifestPathValue(oldManifest?.outPath, root),
    manifestPathValue(oldManifest?.rawDir, root),
  ].filter(Boolean);
  const uniqueOldPaths = [...new Set(oldPaths.map((value) => path.resolve(value)))];
  const backups = [];
  let promotedOutput = false;
  let promotedRaw = false;
  let manifestWritten = false;

  try {
    await fs.mkdir(backupRoot, { recursive: true });
    for (const original of uniqueOldPaths) {
      if (!(await pathExists(original))) continue;
      const backup = path.join(backupRoot, String(backups.length));
      await fs.rename(original, backup);
      backups.push({ original, backup });
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.rename(stagedExport.outPath, outputPath);
    promotedOutput = true;

    await fs.mkdir(path.dirname(rawDir), { recursive: true });
    await fs.rename(stagedExport.rawDir, rawDir);
    promotedRaw = true;

    const promoted = {
      ...stagedExport,
      outPath: outputPath,
      rawDir,
      exportManifestPath: manifestPath,
      lessons: (stagedExport.lessons || []).map((lesson) => ({
        ...lesson,
        rawTextPath: remapStagedPath(lesson.rawTextPath, stagedExport.rawDir, rawDir),
        rawHtmlPath: remapStagedPath(lesson.rawHtmlPath, stagedExport.rawDir, rawDir),
      })),
    };
    const { markdown, ...manifest } = promoted;
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          outPath: manifestRelativePath(outputPath, root),
          rawDir: manifestRelativePath(rawDir, root),
          exportManifestPath: manifestRelativePath(manifestPath, root),
          lessons: manifest.lessons.map((lesson) => ({
            ...lesson,
            rawTextPath: manifestRelativePath(lesson.rawTextPath, root),
            rawHtmlPath: manifestRelativePath(lesson.rawHtmlPath, root),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    manifestWritten = true;

    // Cleanup is deliberately best-effort after the new cache is committed;
    // a stale staging/backup directory is safer than rolling back valid data.
    await fs.rm(path.dirname(stagedExport.exportManifestPath), {
      recursive: true,
      force: true,
    }).catch(() => {});
    await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => {});
    return promoted;
  } catch (error) {
    if (manifestWritten) {
      await fs.rm(manifestPath, { force: true }).catch(() => {});
    }
    if (promotedOutput) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
    }
    if (promotedRaw) {
      await fs.rm(rawDir, { recursive: true, force: true }).catch(() => {});
    }

    for (const { original, backup } of backups.reverse()) {
      if (await pathExists(backup)) {
        await fs.mkdir(path.dirname(original), { recursive: true });
        await fs.rename(backup, original);
      }
    }
    await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
