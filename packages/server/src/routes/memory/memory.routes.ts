import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "../../context.js";
import { memoryEntrySchema, memorySaveSchema } from "./memory.schemas.js";
import { createMemoryHandlers } from "./memory.handlers.js";

export function createMemoryRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const handlers = createMemoryHandlers(ctx);

  router.openapi(
    createRoute({
      method: "get", path: "/", tags: ["Memory"], summary: "List all memory namespaces",
      responses: { 200: { description: "All namespaces", content: { "application/json": { schema: z.object({ namespaces: z.array(z.string()), count: z.number() }) } } } },
    }),
    handlers.handleListNamespaces,
  );

  router.openapi(
    createRoute({
      method: "get", path: "/{id}", tags: ["Memory"], summary: "List all entries in a namespace",
      request: { params: z.object({ id: z.string().openapi({ example: "user-123" }) }) },
      responses: { 200: { description: "Namespace entries", content: { "application/json": { schema: z.object({ entries: z.array(memoryEntrySchema), count: z.number() }) } } } },
    }),
    handlers.handleListEntries,
  );

  router.openapi(
    createRoute({
      method: "post", path: "/{id}", tags: ["Memory"], summary: "Save a memory entry",
      request: { params: z.object({ id: z.string().openapi({ example: "user-123" }) }), body: { content: { "application/json": { schema: memorySaveSchema } } } },
      responses: { 200: { description: "Saved entry", content: { "application/json": { schema: memoryEntrySchema } } } },
    }),
    handlers.handleSaveEntry,
  );

  router.openapi(
    createRoute({
      method: "get", path: "/{id}/{key}", tags: ["Memory"], summary: "Get a specific memory entry",
      request: { params: z.object({ id: z.string().openapi({ example: "user-123" }), key: z.string().openapi({ example: "user_name" }) }) },
      responses: {
        200: { description: "Memory entry", content: { "application/json": { schema: memoryEntrySchema } } },
        404: { description: "Entry not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleGetEntry,
  );

  router.openapi(
    createRoute({
      method: "delete", path: "/{id}/{key}", tags: ["Memory"], summary: "Delete a specific memory entry",
      request: { params: z.object({ id: z.string().openapi({ example: "user-123" }), key: z.string().openapi({ example: "user_name" }) }) },
      responses: {
        200: { description: "Entry deleted", content: { "application/json": { schema: z.object({ deleted: z.boolean(), namespace: z.string(), key: z.string() }) } } },
        404: { description: "Entry not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleDeleteEntry,
  );

  router.openapi(
    createRoute({
      method: "delete", path: "/{id}", tags: ["Memory"], summary: "Clear all entries in a namespace",
      request: { params: z.object({ id: z.string().openapi({ example: "user-123" }) }) },
      responses: { 200: { description: "Namespace cleared", content: { "application/json": { schema: z.object({ cleared: z.boolean(), namespace: z.string() }) } } } },
    }),
    handlers.handleClearNamespace,
  );

  return router;
}
