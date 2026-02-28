/**
 * Test the MCP server endpoint — list tools, call a tool via MCP protocol.
 *
 * Usage: bun scripts/12-mcp-server.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("MCP Server");

const BASE_URL = process.env.KITN_BASE_URL ?? "http://localhost:4000";

// Helper for MCP JSON-RPC calls (MCP endpoint has no API key auth)
async function mcp(method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text,
    json: () => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

// --- Initialize ---
info("POST /mcp — initialize");
let res = await mcp("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "kitn-test-script", version: "1.0.0" },
});
assert.status(res, 200, "Initialize");
assert.contains(res, "serverInfo", "Has server info");

// --- List tools ---
info("POST /mcp — tools/list");
res = await mcp("tools/list", {}, 2);
assert.status(res, 200, "List tools");
assert.contains(res, "getWeather", "Has weather tool");
assert.contains(res, "echo", "Has echo tool");

// --- Call a tool ---
info("POST /mcp — tools/call (echo)");
res = await mcp("tools/call", { name: "echo", arguments: { message: "mcp test" } }, 3);
assert.status(res, 200, "Call echo via MCP");
assert.contains(res, "mcp test", "Echoed message");

// --- Call weather tool ---
info("POST /mcp — tools/call (getWeather)");
res = await mcp("tools/call", { name: "getWeather", arguments: { location: "London" } }, 4);
assert.status(res, 200, "Call weather via MCP");
assert.contains(res, "temperature", "Has temperature");

process.exit(summary());
