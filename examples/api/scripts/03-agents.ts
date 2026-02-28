/**
 * Test agent endpoints — list, detail, general (JSON + SSE), guarded, orchestrator.
 *
 * Usage: bun scripts/03-agents.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Agents");

// --- List agents ---
info("GET /api/agents — list all agents");
let res = await api("GET", "/api/agents");
assert.status(res, 200, "List agents");
assert.contains(res, "general", "Has general agent");
assert.contains(res, "guarded", "Has guarded agent");
assert.contains(res, "orchestrator", "Has orchestrator agent");

// --- Agent detail ---
info("GET /api/agents/general — agent info");
res = await api("GET", "/api/agents/general");
assert.status(res, 200, "Agent detail");
assert.contains(res, "toolNames", "Has tool names");

// --- Agent not found ---
info("GET /api/agents/nonexistent — 404");
res = await api("GET", "/api/agents/nonexistent");
assert.status(res, 404, "Agent not found");

// --- General agent (JSON) ---
info("POST /api/agents/general?format=json — simple math question");
res = await api("POST", "/api/agents/general?format=json", {
  message: "What is 42 * 17? Use the calculator tool and give me just the number.",
});
assert.status(res, 200, "General agent (JSON)");
assert.contains(res, "714", "Correct answer");
assert.contains(res, "usage", "Has usage info");

// --- General agent (SSE) ---
info("POST /api/agents/general — SSE streaming");
const sseRes = await fetch(
  `${process.env.KITN_BASE_URL ?? "http://localhost:4000"}/api/agents/general`,
  {
    method: "POST",
    headers: {
      "X-API-Key": process.env.KITN_API_KEY ?? "demo",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "Echo back the word 'pong'" }),
  },
);
const sseBody = await sseRes.text();
assert.ok(sseRes.status === 200, "SSE status 200");
assert.ok(sseBody.includes("event:"), "SSE has event lines");
assert.ok(sseBody.includes("pong") || sseBody.includes("Pong"), "SSE contains response");

// --- Guarded agent ---
info("POST /api/agents/guarded?format=json — allowed message");
res = await api("POST", "/api/agents/guarded?format=json", {
  message: "Hello there!",
});
assert.status(res, 200, "Guarded agent — allowed");

info("POST /api/agents/guarded?format=json — blocked message");
res = await api("POST", "/api/agents/guarded?format=json", {
  message: "This message contains blocked keyword",
});
assert.status(res, 403, "Guarded agent — blocked");
assert.contains(res, "Guard blocked", "Guard error message");

// --- Orchestrator ---
info("POST /api/agents/orchestrator?format=json — routes to specialist");
res = await api("POST", "/api/agents/orchestrator?format=json", {
  message: "What is the weather in Paris?",
});
assert.status(res, 200, "Orchestrator");
assert.contains(res, "response", "Has response");

process.exit(summary());
