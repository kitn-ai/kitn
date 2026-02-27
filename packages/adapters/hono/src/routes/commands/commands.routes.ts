import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import { streamAgentResponse, runAgent } from "@kitnai/core";

export function createCommandsRoutes(ctx: PluginContext) {
  const router = new Hono();

  // GET / — List commands
  router.get("/", async (c) => {
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const commands = await ctx.storage.commands.list(scopeId);
    return c.json({ commands });
  });

  // GET /:name — Get command
  router.get("/:name", async (c) => {
    const name = c.req.param("name");
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const cmd = await ctx.storage.commands.get(name, scopeId);
    if (!cmd) return c.json({ error: `Command not found: ${name}` }, 404);
    return c.json(cmd);
  });

  // POST / — Create or update command
  router.post("/", async (c) => {
    const body = await c.req.json();
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    await ctx.storage.commands.save(body, scopeId);
    return c.json(body);
  });

  // DELETE /:name — Delete command
  router.delete("/:name", async (c) => {
    const name = c.req.param("name");
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    await ctx.storage.commands.delete(name, scopeId);
    return c.json({ deleted: true });
  });

  // POST /:name/run — Execute command as ad-hoc agent
  router.post("/:name/run", async (c) => {
    const name = c.req.param("name");
    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const cmd = await ctx.storage.commands.get(name, scopeId);
    if (!cmd) return c.json({ error: `Command not found: ${name}` }, 404);

    const body = await c.req.json();
    const format = (c.req.query("format") ?? cmd.format ?? "json") as
      | "json"
      | "sse";

    // Resolve tool names to tool instances
    const tools: Record<string, any> = {};
    if (cmd.tools) {
      for (const toolName of cmd.tools) {
        const reg = ctx.tools.get(toolName);
        if (reg) tools[toolName] = reg.tool;
      }
    }

    if (format === "sse") {
      return streamAgentResponse(ctx, {
        system: cmd.system,
        tools,
        prompt: body.message,
        model: body.model ?? cmd.model,
        conversationId: `cmd_${Date.now()}`,
      });
    }

    const result = await runAgent(
      ctx,
      { system: cmd.system, tools },
      body.message,
      body.model ?? cmd.model,
    );
    return c.json(result);
  });

  return router;
}
