import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";
import { streamAgentResponse, runAgent } from "@kitnai/core";

export function createCommandsRoutes(ctx: PluginContext) {
  return new Elysia({ prefix: "/commands" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const commands = await ctx.storage.commands.list(scopeId);
      return { commands };
    })
    .get("/:name", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const cmd = await ctx.storage.commands.get(params.name, scopeId);
      if (!cmd) return status(404, { error: `Command not found: ${params.name}` });
      return cmd;
    })
    .post("/", async ({ body, headers }) => {
      const b = body as any;
      const scopeId = headers["x-scope-id"] || undefined;
      await ctx.storage.commands.save(b, scopeId);
      return b;
    })
    .delete("/:name", async ({ params, headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      await ctx.storage.commands.delete(params.name, scopeId);
      return { deleted: true };
    })
    .post("/:name/run", async ({ params, query, body, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const cmd = await ctx.storage.commands.get(params.name, scopeId);
      if (!cmd) return status(404, { error: `Command not found: ${params.name}` });

      const b = body as any;
      const format = (query.format ?? cmd.format ?? "json") as "json" | "sse";

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
          prompt: b.message,
          model: b.model ?? cmd.model,
          conversationId: `cmd_${Date.now()}`,
        });
      }

      const result = await runAgent(
        ctx,
        { system: cmd.system, tools },
        b.message,
        b.model ?? cmd.model,
      );
      return result;
    });
}
