import { Elysia } from "elysia";
import { compactConversation } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function createConversationsRoutes(ctx: PluginContext) {
  const store = ctx.storage.conversations;

  return new Elysia({ prefix: "/conversations" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const conversations = await store.list(scopeId);
      return { conversations, count: conversations.length };
    })
    .get("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const conv = await store.get(params.id, scopeId);
      if (!conv) return status(404, { error: "Conversation not found" });
      return conv;
    })
    .post("/", async ({ body, headers }) => {
      const { id } = body as any;
      const scopeId = headers["x-scope-id"] || undefined;
      const conv = await store.create(id, scopeId);
      return conv;
    })
    .delete("/:id", async ({ params, headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const deleted = await store.delete(params.id, scopeId);
      return { deleted, id: params.id };
    })
    .delete("/:id/messages", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      try {
        const conv = await store.clear(params.id, scopeId);
        return conv;
      } catch {
        return status(404, { error: "Conversation not found" });
      }
    })
    .post("/:id/compact", async ({ params, body, status }) => {
      const b = (body ?? {}) as Record<string, unknown>;
      const result = await compactConversation(ctx, params.id, b);
      if (!result) return status(404, { error: "Conversation not found" });
      return { conversationId: params.id, ...result };
    });
}
