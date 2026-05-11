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

  await waitUntilUserCloses(context);
}

// Wait until the user is done with the headed browser, robustly. We can't just
// listen for `context.on("close")` because on macOS Chromium keeps the
// underlying app process alive after the user closes its only window
// ("windowless app" UX), which means the persistent context never sees a
// close event and the spawned child hangs forever — leaving the
// "waiting for browser close" toast stuck in the UI. We also watch each
// page's `close` event and force-close the context once no pages remain.
async function waitUntilUserCloses(context) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    context.on("close", finish);

    const trackPage = (page) => {
      page.on("close", async () => {
        // Brief settle so we don't race a tab swap / redirect popup. If
        // the user really has no pages open after the settle, they're done.
        await new Promise((r) => setTimeout(r, 250));
        if (settled) return;
        if (context.pages().length === 0) {
          await context.close().catch(() => {});
          finish();
        }
      });
    };
    for (const existing of context.pages()) trackPage(existing);
    context.on("page", trackPage);

    process.once("SIGINT", async () => {
      await context.close().catch(() => {});
      finish();
    });
  });
}

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
  //
  // We don't pin on a specific cookie name. Blackboard SaaS varies wildly
  // between institutions and gateway configs — `s_session_id`, `session_id`,
  // `BbRouter`, `web_client_cache_guid`, `JSESSIONID`, and others all
  // appear. Any non-empty unexpired cookie on the Blackboard host is enough
  // evidence that a previous `npm run login` seeded the profile. A user who
  // never logged in has an empty cookie jar for the domain.
  const context = await launchPersistentContext({ headless: true });
  try {
    const cookies = await context.cookies(baseUrl);
    const now = Math.floor(Date.now() / 1000);
    const hasLiveCookie = cookies.some(
      (cookie) =>
        cookie.value !== "" &&
        // Playwright reports session cookies (no Expires attribute) as -1.
        // The persistent profile keeps them across launches, so we treat
        // them as valid when the value is present.
        (cookie.expires === -1 || cookie.expires > now),
    );

    console.log(`Profile dir: ${browserProfileDir()}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Stored cookies for domain: ${cookies.length}`);
    console.log(`Authenticated: ${hasLiveCookie ? "probably yes" : "no"}`);

    if (!hasLiveCookie) {
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
