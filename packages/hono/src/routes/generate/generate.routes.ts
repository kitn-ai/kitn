import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import { createGenerateHandlers } from "./generate.handlers.js";

export function createGenerateRoutes(ctx: PluginContext) {
  const router = new Hono();
  const handlers = createGenerateHandlers(ctx);

  // POST / — Generate text (JSON or SSE via ?format=sse)
  router.post("/", (c) => {
    const format = (c.req.query("format") ?? "json") as "json" | "sse";
    if (format === "sse") return handlers.handleGenerateStream(c);
    return handlers.handleGenerate(c);
  });

  return router;
}
