import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import { createMemoryHandlers } from "./memory.handlers.js";

export function createMemoryRoutes(ctx: PluginContext) {
  const router = new Hono();
  const handlers = createMemoryHandlers(ctx);

  // GET / — List all memory namespaces
  router.get("/", handlers.handleListNamespaces);

  // GET /:id — List all entries in a namespace
  router.get("/:id", handlers.handleListEntries);

  // POST /:id — Save a memory entry
  router.post("/:id", handlers.handleSaveEntry);

  // GET /:id/:key — Get a specific memory entry
  router.get("/:id/:key", handlers.handleGetEntry);

  // DELETE /:id/:key — Delete a specific memory entry
  router.delete("/:id/:key", handlers.handleDeleteEntry);

  // DELETE /:id — Clear all entries in a namespace
  router.delete("/:id", handlers.handleClearNamespace);

  return router;
}
