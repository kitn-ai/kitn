import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import { createCronHandlers } from "./crons.handlers.js";

export function createCronRoutes(ctx: PluginContext) {
  const router = new Hono();
  const handlers = createCronHandlers(ctx);

  router.get("/", handlers.handleList);
  router.post("/", handlers.handleCreate);
  router.post("/tick", handlers.handleTick);
  router.get("/:id", handlers.handleGet);
  router.patch("/:id", handlers.handleUpdate);
  router.delete("/:id", handlers.handleDelete);
  router.post("/:id/run", handlers.handleRun);
  router.get("/:id/history", handlers.handleHistory);

  return router;
}
