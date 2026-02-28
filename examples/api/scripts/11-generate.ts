/**
 * Test the /generate endpoint — direct text generation without agents.
 *
 * Usage: bun scripts/11-generate.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Generate (Direct Text Generation)");

// --- JSON response ---
info("POST /api/generate — JSON response");
let res = await api("POST", "/api/generate", {
  prompt: "Reply with exactly: HELLO_GENERATE",
  systemPrompt: "You are a helpful assistant. Follow instructions exactly.",
});
assert.status(res, 200, "Generate (JSON)");
assert.contains(res, "HELLO_GENERATE", "Expected response");
assert.contains(res, "usage", "Has usage info");

// --- With tools ---
info("POST /api/generate — with calculator tool");
res = await api("POST", "/api/generate", {
  prompt: "What is 99 * 99? Use the calculator and give just the number.",
  tools: ["calculate"],
});
assert.status(res, 200, "Generate with tools");
assert.contains(res, "9801", "Correct calculation");

// --- SSE streaming ---
info("POST /api/generate?format=sse — streaming response");
const sseRes = await fetch(
  `${process.env.KITN_BASE_URL ?? "http://localhost:4000"}/api/generate?format=sse`,
  {
    method: "POST",
    headers: {
      "X-API-Key": process.env.KITN_API_KEY ?? "demo",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: "Say the word 'streaming' and nothing else.",
    }),
  },
);
const sseBody = await sseRes.text();
assert.ok(sseRes.status === 200, "SSE status 200");
assert.ok(sseBody.includes("event:"), "Has SSE events");

process.exit(summary());
