// Load `.env` into process.env BEFORE the server reads any configuration.
// Without this, `configuredNotionApiKey()` and `configuredBlackboardBaseUrl()`
// would always return null and the UI would show "Setup incomplete" even when
// the user's .env is correctly populated.
import "dotenv/config";

import "./backend/web/server.mjs";
