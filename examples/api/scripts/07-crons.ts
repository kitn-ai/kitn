/**
 * Test cron scheduling endpoints — list, create, trigger, history, update, delete.
 *
 * Usage: bun scripts/07-crons.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Cron Scheduling");

// --- List crons (seeded "hourly-news-digest" should exist) ---
info("GET /api/crons — list cron jobs");
let res = await api("GET", "/api/crons");
assert.status(res, 200, "List crons");
assert.contains(res, "hourly-news-digest", "Has seeded cron");

// --- Create a new cron ---
info("POST /api/crons — create test cron");
res = await api("POST", "/api/crons", {
  name: `test-cron-${Date.now()}`,
  description: "Test cron for scripts",
  schedule: "0 */6 * * *",
  agentName: "general",
  input: "Echo back: cron test",
  enabled: false,
});
assert.status(res, 201, "Create cron");
const cronId = res.json()?.id;
assert.ok(!!cronId, "Got cron ID");

if (cronId) {
  // --- Get cron detail ---
  info(`GET /api/crons/${cronId}`);
  res = await api("GET", `/api/crons/${cronId}`);
  assert.status(res, 200, "Get cron detail");
  assert.contains(res, "test-cron", "Correct name");

  // --- Update cron ---
  info(`PATCH /api/crons/${cronId} — enable it`);
  res = await api("PATCH", `/api/crons/${cronId}`, { enabled: true });
  assert.status(res, 200, "Update cron");

  // --- Manually trigger ---
  info(`POST /api/crons/${cronId}/run — manual trigger`);
  res = await api("POST", `/api/crons/${cronId}/run`);
  assert.status(res, 200, "Trigger cron");

  // --- View history ---
  info(`GET /api/crons/${cronId}/history`);
  res = await api("GET", `/api/crons/${cronId}/history`);
  assert.status(res, 200, "Cron history");

  // --- Delete cron ---
  info(`DELETE /api/crons/${cronId}`);
  res = await api("DELETE", `/api/crons/${cronId}`);
  assert.status(res, 200, "Delete cron");
}

process.exit(summary());
