import type { Context } from "hono";
import type { PluginContext } from "@kitnai/core";

export function createMemoryHandlers(ctx: PluginContext) {
  const store = ctx.storage.memory;

  return {
    async handleListNamespaces(c: Context) {
      const namespaces = await store.listNamespaces();
      return c.json({ namespaces, count: namespaces.length }, 200);
    },

    async handleListEntries(c: Context) {
      const id = c.req.param("id");
      const entries = await store.listEntries(id);
      return c.json({ entries, count: entries.length }, 200);
    },

    async handleSaveEntry(c: Context) {
      const id = c.req.param("id");
      const { key, value, context } = await c.req.json();
      const entry = await store.saveEntry(id, key, value, context ?? "");
      return c.json(entry, 200);
    },

    async handleGetEntry(c: Context) {
      const id = c.req.param("id");
      const key = c.req.param("key");
      const entry = await store.getEntry(id, key);
      if (!entry) return c.json({ error: "Entry not found" }, 404);
      return c.json(entry, 200);
    },

    async handleDeleteEntry(c: Context) {
      const id = c.req.param("id");
      const key = c.req.param("key");
      const deleted = await store.deleteEntry(id, key);
      if (!deleted) return c.json({ error: "Entry not found" }, 404);
      return c.json({ deleted: true, namespace: id, key }, 200);
    },

    async handleClearNamespace(c: Context) {
      const id = c.req.param("id");
      await store.clearNamespace(id);
      return c.json({ cleared: true, namespace: id }, 200);
    },
  };
}
