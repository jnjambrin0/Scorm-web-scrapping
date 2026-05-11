// Load `.env` into process.env BEFORE anything else so children spawned by the
// dev-server (the API and Vite) inherit our configuration.
import "dotenv/config";

import "./backend/web/dev-server.mjs";
