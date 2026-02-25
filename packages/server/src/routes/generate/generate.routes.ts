import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "../../context.js";
import { generateRequestSchema, generateResponseSchema } from "./generate.schemas.js";
import { createGenerateHandlers } from "./generate.handlers.js";

export function createGenerateRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const handlers = createGenerateHandlers(ctx);

  router.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["RAG"],
      summary: "Generate text",
      description: "Generate a response from the AI model. Optionally provide tools. Use ?format=sse for streaming.",
      request: {
        body: { content: { "application/json": { schema: generateRequestSchema } } },
      },
      responses: {
        200: {
          description: "Generated response",
          content: { "application/json": { schema: generateResponseSchema } },
        },
      },
    }),
    // hono/zod-openapi handler type mismatch
    ((c: any) => {
      const format = (c.req.query("format") ?? "json") as "json" | "sse";
      if (format === "sse") return handlers.handleGenerateStream(c);
      return handlers.handleGenerate(c);
    }) as any,
  );

  return router;
}
