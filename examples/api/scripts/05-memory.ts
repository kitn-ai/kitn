/**
 * Test memory endpoints — create namespace, save/get/delete entries, clear namespace.
 *
 * Usage: bun scripts/05-memory.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Memory");

const ns = `test-ns-${Date.now()}`;

// --- Save an entry ---
info(`POST /api/memory/${ns} — save an entry`);
let res = await api("POST", `/api/memory/${ns}`, {
  key: "favorite_language",
  value: "TypeScript",
  context: "User preferences",
});
assert.status(res, 200, "Save entry");

// --- Save another entry ---
info(`POST /api/memory/${ns} — save second entry`);
res = await api("POST", `/api/memory/${ns}`, {
  key: "editor",
  value: "VS Code",
});
assert.status(res, 200, "Save second entry");

// --- List namespaces ---
info("GET /api/memory — list namespaces");
res = await api("GET", "/api/memory");
assert.status(res, 200, "List namespaces");
assert.contains(res, ns, "Has test namespace");

// --- List entries in namespace ---
info(`GET /api/memory/${ns} — list entries`);
res = await api("GET", `/api/memory/${ns}`);
assert.status(res, 200, "List entries");
assert.contains(res, "favorite_language", "Has first entry");
assert.contains(res, "editor", "Has second entry");

// --- Get specific entry ---
info(`GET /api/memory/${ns}/favorite_language`);
res = await api("GET", `/api/memory/${ns}/favorite_language`);
assert.status(res, 200, "Get entry");
assert.contains(res, "TypeScript", "Correct value");

// --- Delete one entry ---
info(`DELETE /api/memory/${ns}/editor`);
res = await api("DELETE", `/api/memory/${ns}/editor`);
assert.status(res, 200, "Delete entry");

// Verify deletion
res = await api("GET", `/api/memory/${ns}/editor`);
assert.status(res, 404, "Entry deleted");

// --- Clear namespace ---
info(`DELETE /api/memory/${ns} — clear namespace`);
res = await api("DELETE", `/api/memory/${ns}`);
assert.status(res, 200, "Clear namespace");

process.exit(summary());
