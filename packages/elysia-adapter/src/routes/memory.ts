import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";

export function createMemoryRoutes(ctx: PluginContext) {
  const store = ctx.storage.memory;

  return new Elysia({ prefix: "/memory" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const namespaces = await store.listNamespaces(scopeId);
      return { namespaces, count: namespaces.length };
    })
    .get("/:id", async ({ params, headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const entries = await store.listEntries(params.id, scopeId);
      return { entries, count: entries.length };
    })
    .post("/:id", async ({ params, headers, body }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const { key, value, context } = body as any;
      const entry = await store.saveEntry(params.id, key, value, context ?? "", scopeId);
      return entry;
    })
    .get("/:id/:key", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const entry = await store.getEntry(params.id, params.key, scopeId);
      if (!entry) return status(404, { error: "Entry not found" });
      return entry;
    })
    .delete("/:id/:key", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const deleted = await store.deleteEntry(params.id, params.key, scopeId);
      if (!deleted) return status(404, { error: "Entry not found" });
      return { deleted: true, namespace: params.id, key: params.key };
    })
    .delete("/:id", async ({ params, headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      await store.clearNamespace(params.id, scopeId);
      return { cleared: true, namespace: params.id };
    });
}
