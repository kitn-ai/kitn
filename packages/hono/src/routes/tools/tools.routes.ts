import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";

export function createToolsRoutes(ctx: PluginContext) {
  const router = new Hono();

  // GET / — List all registered tools
  router.get("/", (c) => {
    const tools = ctx.tools.list().map((t) => ({
      name: t.name, description: t.description, category: t.category, inputSchema: t.inputSchema,
      ...(t.examples && { examples: t.examples }),
    }));
    return c.json({ tools, count: tools.length });
  });

  // POST /:toolName — Execute a tool by name
  router.post("/:toolName", async (c) => {
    const name = c.req.param("toolName");
    const tool = ctx.tools.get(name);
    if (!tool) return c.json({ error: `Tool not found: ${name}` }, 404);
    const input = await c.req.json();
    const result = await ctx.tools.execute(name, input);
    return c.json(result, 200);
  });

  return router;
}
