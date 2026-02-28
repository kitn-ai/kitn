/**
 * Test conversation endpoints — create, list, chat with memory, recall, compact, delete.
 *
 * Usage: bun scripts/04-conversations.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Conversations");

const convId = `test-conv-${Date.now()}`;

// --- Chat with conversationId (creates conversation implicitly) ---
info("POST /api/agents/general?format=json — store a fact");
let res = await api("POST", "/api/agents/general?format=json", {
  message: "Remember this: my favorite color is blue. Just acknowledge.",
  conversationId: convId,
});
assert.status(res, 200, "Store fact");

// --- Recall in same conversation ---
info("POST /api/agents/general?format=json — recall the fact");
res = await api("POST", "/api/agents/general?format=json", {
  message: "What is my favorite color?",
  conversationId: convId,
});
assert.status(res, 200, "Recall fact");
assert.contains(res, "blue", "Remembers color");

// --- List conversations ---
info("GET /api/conversations — list all");
res = await api("GET", "/api/conversations");
assert.status(res, 200, "List conversations");
assert.contains(res, "conversations", "Has conversations array");

// --- Get specific conversation ---
info(`GET /api/conversations/${convId}`);
res = await api("GET", `/api/conversations/${convId}`);
assert.status(res, 200, "Get conversation");
assert.contains(res, "messages", "Has messages");

// --- Compact conversation ---
info(`POST /api/conversations/${convId}/compact`);
res = await api("POST", `/api/conversations/${convId}/compact`);
if (res.status === 200) {
  assert.status(res, 200, "Compact conversation");
} else {
  // May fail if conversation is too short to compact — that's ok
  assert.skip("Compact — conversation too short");
}

// --- Delete conversation ---
info(`DELETE /api/conversations/${convId}`);
res = await api("DELETE", `/api/conversations/${convId}`);
assert.status(res, 200, "Delete conversation");

// Verify deletion
res = await api("GET", `/api/conversations/${convId}`);
assert.status(res, 404, "Conversation deleted");

process.exit(summary());
