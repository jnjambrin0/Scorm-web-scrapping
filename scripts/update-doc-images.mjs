// Documentation tooling deliberately does not load dotenv or use a real profile.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./backend/shared/paths.mjs";

if (!process.env.npm_execpath) throw new Error("Run this tool with npm run docs:images.");
const child = spawn(process.execPath, [process.env.npm_execpath, "run", "test:ui"], {
  cwd: ROOT,
  env: { ...process.env, SCORM_DOC_SCREENSHOTS: "1" },
  stdio: "inherit",
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolve(code ?? 1));
});
if (code !== 0) process.exit(code);

const files = {
  "local-app.png": "local-app.png",
  "settings.png": "settings.png",
  "desktop-running.png": "queue-running.png",
  "desktop-summary.png": "queue-summary.png",
  "mobile-running.png": "queue-mobile.png",
  "session-verification.png": "session-verification.png",
  "publication-review.png": "publication-review.png",
};
const target = path.join(ROOT, "docs/assets/readme");
await fs.mkdir(target, { recursive: true });
for (const [source, name] of Object.entries(files)) {
  await fs.copyFile(path.join(ROOT, "artifacts/queue-ui", source), path.join(target, name));
}
console.log(`Updated ${Object.keys(files).length} documentation screenshots using simulated services.`);
