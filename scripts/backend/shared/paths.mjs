import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const EXPORT_DIR = path.join(ROOT, "exports");
export const RAW_EXPORT_DIR = path.join(EXPORT_DIR, "raw");
export const SCORM_EXPORT_MANIFEST_PATH = path.join(
  EXPORT_DIR,
  "scorm-export-manifest.json",
);
export const NOTION_ASSET_DIR = path.join(EXPORT_DIR, "notion-assets");
export const NOTION_ASSET_MANIFEST_PATH = path.join(
  NOTION_ASSET_DIR,
  "manifest.json",
);
export const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
export const DIST_DIR = path.join(ROOT, "dist");

export function browserProfileDir() {
  return (
    process.env.SCORM_BROWSER_PROFILE_DIR ||
    path.join(os.homedir(), ".scorm-scraping", "chromium-profile")
  );
}
