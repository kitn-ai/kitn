import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext, DelegationContext } from "@kitnai/core";
import { agentRequestSchema, agentPatchSchema, AgentEventBus, delegationStore, cancelRequest } from "@kitnai/core";

export function createAgentsRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();

  const agentBody = {
    content: { "application/json": { schema: agentRequestSchema } },
  };

  // GET / — List all registered agents
  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Agents"],
      summary: "List all registered agents",
      description: "Returns metadata for all registered agents",
      responses: {
        200: {
          description: "List of agents",
          content: {
            "application/json": {
              schema: z.object({
                agents: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    defaultFormat: z.string(),
                    formats: z.array(z.string()),
                    toolNames: z.array(z.string()),
                    hasPromptOverride: z.boolean(),
                    actions: z.array(z.string()).optional(),
                    isOrchestrator: z.boolean().optional(),
                    agents: z.array(z.string()).optional(),
                  }),
                ),
                count: z.number(),
              }),
            },
          },
        },
      },
    }),
    (c) => {
      const agents = ctx.agents.list().map((a) => {
        const formats: string[] = [];
        if (a.jsonHandler) formats.push("json");
        if (a.sseHandler) formats.push("sse");
        return {
          name: a.name,
          description: a.description,
          defaultFormat: a.defaultFormat,
          formats,
          toolNames: a.toolNames,
          hasPromptOverride: ctx.agents.hasPromptOverride(a.name),
          actions: a.actions?.map((act) => `${act.method.toUpperCase()} /${a.name}/${act.name}`),
          ...(a.isOrchestrator && { isOrchestrator: true }),
          ...(a.agents && { agents: a.agents }),
        };
      });
      return c.json({ agents, count: agents.length });
    },
  );

  // GET /:agentName — Get agent details
  router.openapi(
    createRoute({
      method: "get",
      path: "/{agentName}",
      tags: ["Agents"],
      summary: "Get agent details",
      description: "Returns agent metadata and current system prompt",
      request: {
        params: z.object({ agentName: z.string().openapi({ example: "weather" }) }),
      },
      responses: {
        200: {
          description: "Agent details",
          content: {
            "application/json": {
              schema: z.object({
                name: z.string(),
                description: z.string(),
                defaultFormat: z.string(),
                formats: z.array(z.string()),
                toolNames: z.array(z.string()),
                systemPrompt: z.string(),
                isDefault: z.boolean(),
                actions: z.array(z.object({
                  name: z.string(),
                  method: z.string(),
                  summary: z.string(),
                  description: z.string(),
                })).optional(),
              }),
            },
          },
        },
        404: { description: "Agent not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    ((c: any) => {
      const name = c.req.param("agentName");
      const agent = ctx.agents.get(name);
      if (!agent) return c.json({ error: `Agent not found: ${name}` }, 404);

      const formats: string[] = [];
      if (agent.jsonHandler) formats.push("json");
      if (agent.sseHandler) formats.push("sse");

      return c.json({
        name: agent.name,
        description: agent.description,
        defaultFormat: agent.defaultFormat,
        formats,
        toolNames: agent.toolNames,
        systemPrompt: ctx.agents.getResolvedPrompt(name) ?? "",
        isDefault: !ctx.agents.hasPromptOverride(name),
        actions: agent.actions?.map((act) => ({
          name: act.name, method: act.method, summary: act.summary, description: act.description,
        })),
      });
    }) as any,
  );

  // PATCH /:agentName — Update system prompt
  router.openapi(
    createRoute({
      method: "patch",
      path: "/{agentName}",
      tags: ["Agents"],
      summary: "Update agent system prompt",
      description: "Set a custom system prompt or reset to default",
      request: {
        params: z.object({ agentName: z.string().openapi({ example: "weather" }) }),
        body: { content: { "application/json": { schema: agentPatchSchema } } },
      },
      responses: {
        200: {
          description: "Prompt updated",
          content: {
            "application/json": {
              schema: z.object({ name: z.string(), systemPrompt: z.string(), isDefault: z.boolean() }),
            },
          },
        },
        404: { description: "Agent not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const name = c.req.param("agentName");
      const agent = ctx.agents.get(name);
      if (!agent) return c.json({ error: `Agent not found: ${name}` }, 404);

      const body = await c.req.json();
      if (body.reset) {
        ctx.agents.resetPrompt(name);
        await ctx.storage.prompts.deleteOverride(name);
      } else if (body.system) {
        ctx.agents.setPromptOverride(name, body.system);
        await ctx.storage.prompts.saveOverride(name, body.system);
      }

      return c.json({
        name,
        systemPrompt: ctx.agents.getResolvedPrompt(name) ?? "",
        isDefault: !ctx.agents.hasPromptOverride(name),
      });
    }) as any,
  );

  // POST /cancel
  router.openapi(
    createRoute({
      method: "post",
      path: "/cancel",
      tags: ["Agents"],
      summary: "Cancel an active agent stream",
      description: "Aborts a running agent request identified by conversationId",
      request: {
        body: { content: { "application/json": { schema: z.object({ conversationId: z.string() }) } } },
      },
      responses: {
        200: {
          description: "Cancellation result",
          content: {
            "application/json": { schema: z.object({ cancelled: z.boolean(), conversationId: z.string() }) },
          },
        },
      },
    }),
    async (c) => {
      const { conversationId } = await c.req.json();
      const cancelled = cancelRequest(conversationId);
      return c.json({ cancelled, conversationId });
    },
  );

  // POST /:agentName/:action — Agent actions
  router.openapi(
    createRoute({
      method: "post",
      path: "/{agentName}/{action}",
      tags: ["Agents"],
      summary: "Execute an agent action",
      description: "Dispatches to a named action on the agent",
      request: {
        params: z.object({
          agentName: z.string().openapi({ example: "human-in-loop" }),
          action: z.string().openapi({ example: "approve" }),
        }),
        body: { content: { "application/json": { schema: z.any() } } },
      },
      responses: {
        200: { description: "Action result", content: { "application/json": { schema: z.any() } } },
        404: { description: "Agent or action not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const agentName = c.req.param("agentName");
      const actionName = c.req.param("action");
      const agent = ctx.agents.get(agentName);
      if (!agent) return c.json({ error: `Agent not found: ${agentName}` }, 404);
      const action = agent.actions?.find((a) => a.name === actionName);
      if (!action) return c.json({ error: `Action not found: ${actionName} on agent ${agentName}` }, 404);
      return action.handler(c);
    }) as any,
  );

  // POST /:agentName — Dynamic dispatch
  router.openapi(
    createRoute({
      method: "post",
      path: "/{agentName}",
      tags: ["Agents"],
      summary: "Execute an agent",
      description: "Dispatches to the named agent. Use ?format=json or ?format=sse.",
      request: {
        params: z.object({ agentName: z.string().openapi({ example: "weather" }) }),
        body: agentBody,
      },
      responses: {
        200: { description: "Agent response", content: { "application/json": { schema: z.any() } } },
        400: { description: "Unsupported format", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
        404: { description: "Agent not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    // hono/zod-openapi handler type mismatch
    (async (c: any) => {
      const name = c.req.param("agentName");
      const agent = ctx.agents.get(name);
      if (!agent) return c.json({ error: `Agent not found: ${name}` }, 404);

      const format = (c.req.query("format") ?? agent.defaultFormat) as "json" | "sse";
      const handler = format === "sse" ? agent.sseHandler : agent.jsonHandler;

      if (!handler) {
        const supported = [agent.jsonHandler && "json", agent.sseHandler && "sse"].filter(Boolean);
        return c.json({ error: `Agent "${name}" does not support format "${format}". Supported: ${supported.join(", ")}` }, 400);
      }

      const systemPrompt = ctx.agents.getResolvedPrompt(name) ?? "";

      let memoryContext: string | undefined;
      try {
        const body = await c.req.json();
        if (body.memoryIds && Array.isArray(body.memoryIds) && body.memoryIds.length > 0) {
          const memories = await ctx.storage.memory.loadMemoriesForIds(body.memoryIds);
          if (memories.length > 0) {
            memoryContext = memories.map((m) => `[${m.namespace}] ${m.key}: ${m.value}`).join("\n");
          }
        }
      } catch { /* body parsing may fail on re-read */ }

      if (format === "sse") {
        const bus = new AgentEventBus();
        const delegationCtx: DelegationContext = { chain: [], depth: 0, events: bus, orchestrator: name };
        return delegationStore.run(delegationCtx, () => handler(c.req, { systemPrompt, memoryContext }));
      }

      return handler(c.req, { systemPrompt, memoryContext });
    }) as any,
  );

  return router;
}
