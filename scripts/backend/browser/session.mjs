import { launchPersistentContext } from "./context.mjs";
import { configuredBlackboardBaseUrl } from "../shared/env.mjs";
import { browserProfileDir } from "../shared/paths.mjs";

function requireBlackboardBaseUrl() {
  const url = configuredBlackboardBaseUrl();
  if (!url) {
    throw new Error(
      "BLACKBOARD_BASE_URL is not set. Add it to your .env (e.g. https://<your-institution>.blackboard.com/ultra/stream) and try again.",
    );
  }
  return url;
}

export async function openBlackboard({ mode }) {
  const baseUrl = requireBlackboardBaseUrl();
  const context = await launchPersistentContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  console.log(`Profile dir: ${browserProfileDir()}`);
  console.log(`Current URL: ${page.url()}`);
  console.log(`Mode: ${mode}`);

  if (mode === "login") {
    console.log("");
    console.log("Log in manually in the opened browser window.");
    console.log("When Blackboard has loaded, close the browser window.");
  } else {
    console.log("");
    console.log("Using the saved browser profile. Close the window when done.");
  }

  await new Promise((resolve) => {
    context.on("close", resolve);
    process.once("SIGINT", async () => {
      await context.close();
      resolve();
    });
  });
}

export async function checkSession() {
  const baseUrl = requireBlackboardBaseUrl();
  // Headless: this probe doesn't need user interaction. Cookies live in the
  // persistent profile, so the saved session from a prior `npm run login`
  // (which had to be headed for the user to type credentials) is reused here.
  const context = await launchPersistentContext({ headless: true });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const title = await page.title();
  const url = page.url();
  const loginLike =
    url.includes("login.microsoftonline.com") ||
    title.toLowerCase().includes("sign in");

  console.log(`Profile dir: ${browserProfileDir()}`);
  console.log(`Title: ${title}`);
  console.log(`URL: ${url}`);
  console.log(`Authenticated: ${loginLike ? "no" : "probably yes"}`);

  await context.close();

  if (loginLike) {
    process.exitCode = 1;
  }
}

export async function runBlackboardBrowserCommand(command = process.argv[2] || "open") {
  switch (command) {
    case "login":
      await openBlackboard({ mode: "login" });
      break;
    case "open":
      await openBlackboard({ mode: "open" });
      break;
    case "check-session":
      await checkSession();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use one of: login, open, check-session");
      process.exitCode = 2;
  }
}
