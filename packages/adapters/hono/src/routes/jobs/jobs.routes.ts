import { Hono } from "hono";
import type { PluginContext, EventBuffer } from "@kitnai/core";
import { createJobHandlers } from "./jobs.handlers.js";

export function createJobRoutes(ctx: PluginContext, eventBuffer: EventBuffer) {
  const router = new Hono();
  const handlers = createJobHandlers(ctx, eventBuffer);

  router.get("/", handlers.handleList);
  router.get("/:id", handlers.handleGet);
  router.get("/:id/stream", handlers.handleStream);
  router.post("/:id/cancel", handlers.handleCancel);
  router.delete("/:id", handlers.handleDelete);

  return router;
}
