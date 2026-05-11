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

// Blackboard Ultra issues `s_session_id` (TLS-protected, the canonical session
// marker on https deployments) and may also set `session_id` or `JSESSIONID`
// on legacy paths. Any non-empty, unexpired cookie from this set means the
// previous `npm run login` left usable credentials in the persistent profile.
const SESSION_COOKIE_NAMES = new Set([
  "s_session_id",
  "session_id",
  "JSESSIONID",
]);

export async function checkSession() {
  const baseUrl = requireBlackboardBaseUrl();

  // We deliberately do NOT navigate to Blackboard. Institutions that enable
  // Concurrent Session Control (Admin > Security > Account Lock Settings)
  // evict the oldest active session as soon as a *new* one checks in — so a
  // single `page.goto(baseUrl)` from this automation logs the user out of
  // their personal Chrome, mobile app, and every other device. Instead, we
  // read the cookie jar locally: `context.cookies(urls)` is a pure in-memory
  // read from the persistent profile and never sends HTTP traffic to
  // Blackboard. The trade-off is that we can't catch a server-side
  // invalidation (revoked cookie, admin force-logout); in those cases the
  // next Publish/Export will surface `session.expired` via the existing
  // error classifier, which is good enough.
  const context = await launchPersistentContext({ headless: true });
  try {
    const cookies = await context.cookies(baseUrl);
    const now = Math.floor(Date.now() / 1000);
    const session = cookies.find(
      (cookie) =>
        SESSION_COOKIE_NAMES.has(cookie.name) &&
        cookie.value !== "" &&
        // Playwright reports session cookies (no Expires attribute) as -1.
        // The persistent profile keeps them across launches, so we treat
        // them as valid when the value is present.
        (cookie.expires === -1 || cookie.expires > now),
    );

    console.log(`Profile dir: ${browserProfileDir()}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Stored cookies for domain: ${cookies.length}`);
    console.log(`Authenticated: ${session ? "probably yes" : "no"}`);

    if (!session) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
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
