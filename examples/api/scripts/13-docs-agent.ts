/**
 * Test the docs agent (requires MCP_CONTEXT7=true).
 *
 * Usage: bun scripts/13-docs-agent.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Docs Agent (Context7 MCP)");

// Check if docs agent is registered
info("GET /api/agents — check for docs agent");
let res = await api("GET", "/api/agents");
const agents = res.json();
const hasDocsAgent = agents?.agents?.some((a: any) => a.name === "docs");

if (!hasDocsAgent) {
  assert.skip("Docs agent not registered — set MCP_CONTEXT7=true to enable");
  process.exit(summary());
}

assert.ok(true, "Docs agent registered");

// --- Query docs agent ---
info("POST /api/agents/docs?format=json — look up Hono routing docs");
res = await api("POST", "/api/agents/docs?format=json", {
  message: "How do I set up routing in Hono? Give a brief code example.",
});
assert.status(res, 200, "Docs agent response");
assert.contains(res, "response", "Has response");
assert.contains(res, "toolsUsed", "Has toolsUsed");

// Verify it actually used the Context7 tools
const data = res.json();
const tools = data?.toolsUsed ?? [];
assert.ok(
  tools.some((t: string) => t.includes("context7")),
  "Used Context7 tools",
);

process.exit(summary());
