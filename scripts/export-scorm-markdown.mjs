import "dotenv/config";

import { fileURLToPath } from "node:url";

export {
  dedupeBlankLines,
  exportScormMarkdown,
  launchPersistentContext,
  openScorm,
  postProcessMarkdown,
  readLessonMarkdown,
  readOverview,
  safeFilename,
  waitForFrame,
} from "./backend/scorm/markdown-exporter.mjs";

import { exportScormMarkdown } from "./backend/scorm/markdown-exporter.mjs";

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await exportScormMarkdown();
}
