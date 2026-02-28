/**
 * Test API key authentication.
 *
 * Usage: bun scripts/01-auth.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Authentication");

info("GET /api/agents — no API key (expect 401)");
let res = await api("GET", "/api/agents", undefined, { skipAuth: true });
assert.status(res, 401, "Missing API key");
assert.contains(res, "Unauthorized", "Error message");

info("GET /api/agents — wrong API key (expect 401)");
res = await api("GET", "/api/agents", undefined, {
  skipAuth: true,
  headers: { "X-API-Key": "wrong-key" },
});
assert.status(res, 401, "Wrong API key");

info("GET /api/agents — correct API key (expect 200)");
res = await api("GET", "/api/agents");
assert.status(res, 200, "Valid API key");
assert.contains(res, "agents", "Returns agent list");

process.exit(summary());
