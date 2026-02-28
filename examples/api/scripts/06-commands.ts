/**
 * Test command endpoints — list, get, create, run, delete.
 *
 * Usage: bun scripts/06-commands.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Commands");

// --- List commands (seeded "status" command should exist) ---
info("GET /api/commands — list commands");
let res = await api("GET", "/api/commands");
assert.status(res, 200, "List commands");
assert.contains(res, "status", "Has seeded status command");

// --- Get command detail ---
info("GET /api/commands/status");
res = await api("GET", "/api/commands/status");
assert.status(res, 200, "Get command");
assert.contains(res, "description", "Has description");

// --- Create a new command ---
const cmdName = `test-cmd-${Date.now()}`;
info(`POST /api/commands — create "${cmdName}"`);
res = await api("POST", "/api/commands", {
  name: cmdName,
  description: "Test command for scripts",
  system: "You are a helpful assistant. Respond in one short sentence.",
  tools: ["echo"],
});
assert.status(res, 200, "Create command");

// --- Run the seeded "status" command (JSON) ---
info("POST /api/commands/status/run?format=json");
res = await api("POST", "/api/commands/status/run?format=json", {
  message: "Give a one-line status summary.",
});
assert.status(res, 200, "Run command");
assert.contains(res, "response", "Has response");

// --- Delete test command ---
info(`DELETE /api/commands/${cmdName}`);
res = await api("DELETE", `/api/commands/${cmdName}`);
assert.status(res, 200, "Delete command");

process.exit(summary());
