import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";

export function createHealthRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();

  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Health"],
      summary: "Health check",
      responses: {
        200: {
          description: "Server is healthy",
          content: {
            "application/json": {
              schema: z.object({
                status: z.string(),
                timestamp: z.string(),
                agents: z.number(),
                tools: z.number(),
              }),
            },
          },
        },
      },
    }),
    (c) => {
      return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        agents: ctx.agents.list().length,
        tools: ctx.tools.list().length,
      });
    },
  );

  return router;
}
