import "dotenv/config";

import { backupBrowserProfile } from "./backend/browser/reset-profile.mjs";
import { browserProfileDir } from "./backend/shared/paths.mjs";

if (!process.argv.includes("--confirm")) {
  console.error(
    `Refusing to reset ${browserProfileDir()} without --confirm. The profile will be moved to a reversible backup.`,
  );
  process.exitCode = 2;
} else {
  try {
    const result = await backupBrowserProfile(browserProfileDir());
    if (result.status === "missing") {
      console.log(`Browser profile is already clean: ${result.profileDir}`);
    } else {
      console.log(`Browser profile moved to backup: ${result.backupDir}`);
      console.log("Run npm run login to create a fresh authenticated profile.");
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
