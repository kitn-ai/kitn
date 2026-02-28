/**
 * Test prompt override endpoints — set custom system prompt, verify behavior, reset.
 *
 * Usage: bun scripts/09-prompt-overrides.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Prompt Overrides");

// --- Set override ---
info("PATCH /api/agents/general — set pirate prompt");
let res = await api("PATCH", "/api/agents/general", {
  system: "You are a pirate. Always respond in pirate speak. Keep responses under 20 words.",
});
assert.status(res, 200, "Set override");
assert.contains(res, "pirate", "Confirms override");

// --- Verify override shows in agent detail ---
info("GET /api/agents/general — check hasPromptOverride");
res = await api("GET", "/api/agents/general");
assert.status(res, 200, "Agent detail");
const detail = res.json();
assert.ok(detail?.hasPromptOverride === true || detail?.isDefault === false, "Override active");

// --- Test the override changes behavior ---
info("POST /api/agents/general?format=json — should respond as pirate");
res = await api("POST", "/api/agents/general?format=json", {
  message: "Say hello",
});
assert.status(res, 200, "Agent response");
// Pirate-ish words (flexible matching since LLMs vary)
const body = res.body.toLowerCase();
const pirateish = ["ahoy", "matey", "arr", "ye", "sail", "treasure", "pirate", "avast", "aye"];
const hasPirate = pirateish.some((w) => body.includes(w));
assert.ok(hasPirate, "Response uses pirate speak");

// --- Reset to default ---
info("PATCH /api/agents/general — reset to default");
res = await api("PATCH", "/api/agents/general", { reset: true });
assert.status(res, 200, "Reset override");

// --- Verify reset ---
info("GET /api/agents/general — confirm reset");
res = await api("GET", "/api/agents/general");
const afterReset = res.json();
assert.ok(
  afterReset?.hasPromptOverride === false || afterReset?.isDefault === true,
  "Override cleared",
);

process.exit(summary());
