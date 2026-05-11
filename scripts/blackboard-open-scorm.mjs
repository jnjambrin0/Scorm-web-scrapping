import "dotenv/config";

import { openScormForDebug } from "./backend/scorm/debug-open.mjs";

await openScormForDebug();
