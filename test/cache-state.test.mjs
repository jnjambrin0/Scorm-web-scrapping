import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifyExportCache,
  promoteStagedExport,
  resolveArtifactPath,
  SCORM_EXPORT_MANIFEST_SCHEMA_VERSION,
} from "../scripts/backend/notion/cache.mjs";

const sourceUrlIdentity =
  "https://u-tad.blackboard.com/ultra/courses/_14330_1/scorm/overview/_641800_1";

function validManifest(sourceUrlIdentity) {
  return {
    schemaVersion: SCORM_EXPORT_MANIFEST_SCHEMA_VERSION,
    sourceUrlIdentity,
    lessons: [{}],
  };
}

test("reports precise reasons for unavailable export cache", () => {
  assert.equal(classifyExportCache({ currentSourceUrlIdentity: sourceUrlIdentity }).reason, "manifest-missing");
  assert.equal(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: "not-json",
    }).reason,
    "manifest-invalid",
  );
  assert.equal(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: validManifest(sourceUrlIdentity),
      markdownExists: false,
    }).reason,
    "markdown-missing",
  );
  assert.equal(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: validManifest("other-source"),
      markdownExists: true,
    }).reason,
    "source-mismatch",
  );
});

test("accepts a complete cache only when source and markdown are present", () => {
  assert.deepEqual(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: validManifest(sourceUrlIdentity),
      markdownExists: true,
    }),
    { status: "valid", reason: "valid" },
  );
});

test("resolves portable manifest paths relative to the repository root", () => {
  assert.equal(
    resolveArtifactPath("exports/unit.md", "/workspace/exports/manifest.json", "/workspace"),
    "/workspace/exports/unit.md",
  );
  assert.equal(
    resolveArtifactPath("/tmp/unit.md", "/workspace/exports/manifest.json", "/workspace"),
    "/tmp/unit.md",
  );
});

test("preserves the old export when staging promotion fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-cache-"));
  const manifestPath = path.join(root, "exports", "scorm-export-manifest.json");
  const outputPath = path.join(root, "exports", "old.md");
  const rawDir = path.join(root, "exports", "raw");
  await fs.mkdir(rawDir, { recursive: true });
  await fs.writeFile(outputPath, "old markdown", "utf8");
  await fs.writeFile(path.join(rawDir, "old.txt"), "old raw", "utf8");
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: SCORM_EXPORT_MANIFEST_SCHEMA_VERSION,
      sourceUrlIdentity: "old-source",
      outPath: "exports/old.md",
      rawDir: "exports/raw",
    }),
  );

  await assert.rejects(() =>
    promoteStagedExport(
      {
        sourceUrlIdentity,
        outPath: path.join(root, "stage", "missing.md"),
        rawDir: path.join(root, "stage", "raw"),
        exportManifestPath: path.join(root, "stage", "manifest.json"),
        lessons: [],
      },
      { manifestPath, outputPath, rawDir, root },
    ),
  );

  assert.equal(await fs.readFile(outputPath, "utf8"), "old markdown");
  assert.equal(await fs.readFile(path.join(rawDir, "old.txt"), "utf8"), "old raw");
  await fs.rm(root, { recursive: true, force: true });
});

test("promotes a complete staged export with portable manifest paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-cache-"));
  const stageDir = path.join(root, "stage");
  const stageRawDir = path.join(stageDir, "raw");
  const stageMarkdown = path.join(stageDir, "markdown.md");
  const stageManifest = path.join(stageDir, "manifest.json");
  const manifestPath = path.join(root, "exports", "scorm-export-manifest.json");
  const outputPath = path.join(root, "exports", "new.md");
  const rawDir = path.join(root, "exports", "raw");
  await fs.mkdir(stageRawDir, { recursive: true });
  await fs.writeFile(stageMarkdown, "new markdown", "utf8");
  const stageRawFile = path.join(stageRawDir, "01-lesson.txt");
  await fs.writeFile(stageRawFile, "new raw", "utf8");
  await fs.writeFile(stageManifest, "{}", "utf8");

  const promoted = await promoteStagedExport(
    {
      schemaVersion: SCORM_EXPORT_MANIFEST_SCHEMA_VERSION,
      sourceUrlIdentity,
      courseOutlineUrl: sourceUrlIdentity,
      title: "New unit",
      outPath: stageMarkdown,
      rawDir: stageRawDir,
      exportManifestPath: stageManifest,
      lessons: [{ rawTextPath: stageRawFile, rawHtmlPath: stageRawFile }],
      markdown: "new markdown",
    },
    { manifestPath, outputPath, rawDir, root },
  );

  assert.equal(await fs.readFile(outputPath, "utf8"), "new markdown");
  assert.equal(await fs.readFile(path.join(rawDir, "01-lesson.txt"), "utf8"), "new raw");
  assert.equal(promoted.outPath, outputPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.outPath, "exports/new.md");
  assert.equal(manifest.rawDir, "exports/raw");
  assert.equal(manifest.lessons[0].rawTextPath, "exports/raw/01-lesson.txt");
  await fs.rm(root, { recursive: true, force: true });
});

test("does not reuse a cache between bare and outline SCORM routes", () => {
  const outlineSourceUrlIdentity =
    "https://u-tad.blackboard.com/ultra/courses/_14330_1/outline/scorm/overview/_641800_1?courseId=_14330_1";

  assert.deepEqual(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: validManifest(outlineSourceUrlIdentity),
      markdownExists: true,
    }),
    { status: "unavailable", reason: "source-mismatch" },
  );
});

test("marks legacy manifests for a safe source schema migration", () => {
  assert.deepEqual(
    classifyExportCache({
      currentSourceUrlIdentity: sourceUrlIdentity,
      manifest: { sourceUrlIdentity, lessons: [{}] },
      markdownExists: true,
    }),
    { status: "unavailable", reason: "source-schema-migration" },
  );
});
