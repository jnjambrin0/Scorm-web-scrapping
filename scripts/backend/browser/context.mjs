import { chromium } from "playwright";

import { browserProfileDir } from "../shared/paths.mjs";

export async function launchPersistentContext(options = {}) {
  const {
    headless = false,
    profileDir = browserProfileDir(),
    viewport = { width: 1440, height: 1000 },
    acceptDownloads = true,
  } = options;
  const baseOptions = {
    headless,
    viewport,
    acceptDownloads,
  };

  const preferredChannel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...baseOptions,
      channel: preferredChannel,
    });
  } catch (error) {
    if (process.env.PLAYWRIGHT_CHANNEL) {
      throw error;
    }

    console.warn(
      `Could not launch Chrome channel, falling back to bundled Chromium: ${error.message}`,
    );
    return chromium.launchPersistentContext(profileDir, baseOptions);
  }
}
