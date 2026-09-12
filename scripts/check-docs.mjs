// Local documentation checks: no dotenv, browser session, or network access.
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./backend/shared/paths.mjs";

const documents = ["README.md", "docs/architecture.md", "docs/development-guide.md", "docs/assets/readme/README.md", "AGENTS.md", "CLAUDE.md"];
const failures = [];
let checked = 0;
const slug = (value) => value.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/ /g, "-");
for (const name of documents) {
  const file = path.join(ROOT, name);
  let text;
  try { text = await fs.readFile(file, "utf8"); } catch (error) {
    // Agent entrypoints are intentionally local-only and absent in fresh clones.
    if (["AGENTS.md", "CLAUDE.md"].includes(name) && error.code === "ENOENT") continue;
    throw error;
  }
  const content = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
  const links = [...content.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
  links.push(...[...content.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
  for (const target of links) {
    if (/^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    const [relative, fragment] = target.split("#");
    const resolved = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
    try {
      await fs.access(resolved);
      if (fragment && resolved.endsWith(".md")) {
        const markdown = await fs.readFile(resolved, "utf8");
        const anchors = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1]));
        if (!anchors.includes(decodeURIComponent(fragment))) throw new Error("missing anchor");
      }
      checked++;
    } catch { failures.push(`${name}: ${target}`); }
  }
}
if (failures.length) {
  console.error(`Broken local documentation links:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Documentation links verified: ${checked}.`);
