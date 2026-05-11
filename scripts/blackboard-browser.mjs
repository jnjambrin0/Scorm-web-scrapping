// Load `.env` first so `BLACKBOARD_BASE_URL` is available when the session
// helpers read it. Required for `npm run login` and `npm run check-session`.
import "dotenv/config";

import { runBlackboardBrowserCommand } from "./backend/browser/session.mjs";

await runBlackboardBrowserCommand();
