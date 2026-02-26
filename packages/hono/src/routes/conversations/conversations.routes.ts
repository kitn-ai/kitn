import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import { compactConversation } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function createConversationsRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const store = ctx.storage.conversations;

  router.openapi(
    createRoute({
      method: "get", path: "/", tags: ["Conversations"], summary: "List all conversations",
      responses: { 200: { description: "All conversations", content: { "application/json": { schema: z.object({ conversations: z.array(z.object({ id: z.string(), messageCount: z.number(), updatedAt: z.string() })), count: z.number() }) } } } },
    }),
    async (c) => {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const conversations = await store.list(scopeId);
      return c.json({ conversations, count: conversations.length }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "get", path: "/{id}", tags: ["Conversations"], summary: "Get a conversation",
      request: { params: z.object({ id: z.string().openapi({ example: "conv_kanban_taskboard" }) }) },
      responses: {
        200: { description: "Full conversation", content: { "application/json": { schema: z.object({ id: z.string(), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string(), timestamp: z.string() })), createdAt: z.string(), updatedAt: z.string() }) } } },
        404: { description: "Conversation not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    async (c) => {
      const { id } = c.req.param();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const conv = await store.get(id, scopeId);
      if (!conv) return c.json({ error: "Conversation not found" }, 404);
      return c.json(conv, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "post", path: "/", tags: ["Conversations"], summary: "Create a new conversation",
      request: { body: { content: { "application/json": { schema: z.object({ id: z.string().openapi({ example: "conv_kanban_taskboard" }) }) } } } },
      responses: { 200: { description: "Created conversation", content: { "application/json": { schema: z.object({ id: z.string(), messages: z.array(z.any()), createdAt: z.string(), updatedAt: z.string() }) } } } },
    }),
    async (c) => {
      const { id } = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const conv = await store.create(id, scopeId);
      return c.json(conv, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "delete", path: "/{id}", tags: ["Conversations"], summary: "Delete a conversation",
      request: { params: z.object({ id: z.string().openapi({ example: "conv_kanban_taskboard" }) }) },
      responses: { 200: { description: "Conversation deleted", content: { "application/json": { schema: z.object({ deleted: z.boolean(), id: z.string() }) } } } },
    }),
    async (c) => {
      const { id } = c.req.param();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const deleted = await store.delete(id, scopeId);
      return c.json({ deleted, id }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "delete", path: "/{id}/messages", tags: ["Conversations"], summary: "Clear conversation messages",
      request: { params: z.object({ id: z.string().openapi({ example: "conv_kanban_taskboard" }) }) },
      responses: {
        200: { description: "Messages cleared", content: { "application/json": { schema: z.object({ id: z.string(), messages: z.array(z.any()), createdAt: z.string(), updatedAt: z.string() }) } } },
        404: { description: "Conversation not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    async (c) => {
      const { id } = c.req.param();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      try {
        const conv = await store.clear(id, scopeId);
        return c.json(conv, 200);
      } catch {
        return c.json({ error: "Conversation not found" }, 404);
      }
    },
  );

  router.openapi(
    createRoute({
      method: "post", path: "/{id}/compact", tags: ["Conversations"], summary: "Compact conversation by summarizing older messages",
      request: {
        params: z.object({ id: z.string().openapi({ example: "conv_kanban_taskboard" }) }),
        body: { content: { "application/json": { schema: z.object({ preserveRecent: z.number().optional(), prompt: z.string().optional(), model: z.string().optional() }) } }, required: false },
      },
      responses: {
        200: { description: "Compaction result", content: { "application/json": { schema: z.object({ conversationId: z.string(), summary: z.string(), summarizedCount: z.number(), preservedCount: z.number(), newMessageCount: z.number() }) } } },
        404: { description: "Conversation not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    async (c) => {
      const { id } = c.req.param();
      const body = await c.req.json().catch(() => ({}));
      // TODO: thread scopeId through compactConversation once @kitnai/core supports it
      const result = await compactConversation(ctx, id, body);
      if (!result) return c.json({ error: "Conversation not found" }, 404);
      return c.json({ conversationId: id, ...result }, 200);
    },
  );

  return router;
}
