import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";
import { streamAgentResponse, runAgent } from "@kitnai/core";

const commandSchema = z.object({
  name: z.string(),
  description: z.string(),
  system: z.string(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  format: z.enum(["json", "sse"]).optional(),
});

export function createCommandsRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();

  // GET / — List commands
  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Commands"],
      summary: "List all commands",
      responses: {
        200: {
          description: "List of commands",
          content: {
            "application/json": {
              schema: z.object({ commands: z.array(commandSchema) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const commands = await ctx.storage.commands.list(scopeId);
      return c.json({ commands });
    },
  );

  // GET /:name — Get command
  router.openapi(
    createRoute({
      method: "get",
      path: "/{name}",
      tags: ["Commands"],
      summary: "Get a command by name",
      request: {
        params: z.object({ name: z.string() }),
      },
      responses: {
        200: {
          description: "Command details",
          content: { "application/json": { schema: commandSchema } },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": { schema: z.object({ error: z.string() }) },
          },
        },
      },
    }),
    (async (c: any) => {
      const name = c.req.param("name");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const cmd = await ctx.storage.commands.get(name, scopeId);
      if (!cmd) return c.json({ error: `Command not found: ${name}` }, 404);
      return c.json(cmd);
    }) as any,
  );

  // POST / — Create or update command
  router.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["Commands"],
      summary: "Create or update a command",
      request: {
        body: {
          content: { "application/json": { schema: commandSchema } },
        },
      },
      responses: {
        200: {
          description: "Command saved",
          content: { "application/json": { schema: commandSchema } },
        },
      },
    }),
    async (c) => {
      const body = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      await ctx.storage.commands.save(body, scopeId);
      return c.json(body);
    },
  );

  // DELETE /:name — Delete command
  router.openapi(
    createRoute({
      method: "delete",
      path: "/{name}",
      tags: ["Commands"],
      summary: "Delete a command",
      request: {
        params: z.object({ name: z.string() }),
      },
      responses: {
        200: {
          description: "Command deleted",
          content: {
            "application/json": {
              schema: z.object({ deleted: z.boolean() }),
            },
          },
        },
      },
    }),
    (async (c: any) => {
      const name = c.req.param("name");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      await ctx.storage.commands.delete(name, scopeId);
      return c.json({ deleted: true });
    }) as any,
  );

  // POST /:name/run — Execute command as ad-hoc agent
  router.openapi(
    createRoute({
      method: "post",
      path: "/{name}/run",
      tags: ["Commands"],
      summary: "Run a command",
      request: {
        params: z.object({ name: z.string() }),
        body: {
          content: {
            "application/json": {
              schema: z.object({
                message: z.string(),
                model: z.string().optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Command result",
          content: { "application/json": { schema: z.any() } },
        },
        404: {
          description: "Command not found",
          content: {
            "application/json": { schema: z.object({ error: z.string() }) },
          },
        },
      },
    }),
    (async (c: any) => {
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
    }) as any,
  );

  return router;
}
