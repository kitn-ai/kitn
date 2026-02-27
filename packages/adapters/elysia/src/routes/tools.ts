import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";

export function createToolsRoutes(ctx: PluginContext) {
  return new Elysia({ prefix: "/tools" })
    .get("/", () => {
      const tools = ctx.tools.list().map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        inputSchema: t.inputSchema,
        ...(t.examples && { examples: t.examples }),
      }));
      return { tools, count: tools.length };
    })
    .post("/:toolName", async ({ params, body, status }) => {
      const tool = ctx.tools.get(params.toolName);
      if (!tool) return status(404, { error: `Tool not found: ${params.toolName}` });
      const result = await ctx.tools.execute(params.toolName, body);
      return result;
    });
}
