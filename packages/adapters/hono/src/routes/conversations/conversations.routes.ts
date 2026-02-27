import { Hono } from "hono";
import { compactConversation } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function createConversationsRoutes(ctx: PluginContext) {
  const router = new Hono();
  const store = ctx.storage.conversations;

  // GET / — List all conversations
  router.get("/", async (c) => {
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const conversations = await store.list(scopeId);
    return c.json({ conversations, count: conversations.length }, 200);
  });

  // GET /:id — Get a conversation
  router.get("/:id", async (c) => {
    const { id } = c.req.param();
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const conv = await store.get(id, scopeId);
    if (!conv) return c.json({ error: "Conversation not found" }, 404);
    return c.json(conv, 200);
  });

  // POST / — Create a new conversation
  router.post("/", async (c) => {
    const { id } = await c.req.json();
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const conv = await store.create(id, scopeId);
    return c.json(conv, 200);
  });

  // DELETE /:id — Delete a conversation
  router.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const deleted = await store.delete(id, scopeId);
    return c.json({ deleted, id }, 200);
  });

  // DELETE /:id/messages — Clear conversation messages
  router.delete("/:id/messages", async (c) => {
    const { id } = c.req.param();
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    try {
      const conv = await store.clear(id, scopeId);
      return c.json(conv, 200);
    } catch {
      return c.json({ error: "Conversation not found" }, 404);
    }
  });

  // POST /:id/compact — Compact conversation by summarizing older messages
  router.post("/:id/compact", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    // TODO: thread scopeId through compactConversation once @kitnai/core supports it
    const result = await compactConversation(ctx, id, body);
    if (!result) return c.json({ error: "Conversation not found" }, 404);
    return c.json({ conversationId: id, ...result }, 200);
  });

  return router;
}
