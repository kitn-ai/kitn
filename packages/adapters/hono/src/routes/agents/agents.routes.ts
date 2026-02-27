import { Hono } from "hono";
import type { PluginContext, DelegationContext } from "@kitnai/core";
import { AgentEventBus, delegationStore, cancelRequest } from "@kitnai/core";

export function createAgentsRoutes(ctx: PluginContext) {
  const router = new Hono();

  // GET / — List all registered agents
  router.get("/", async (c) => {
    const agents = await Promise.all(ctx.agents.list().map(async (a) => {
      const formats: string[] = [];
      if (a.jsonHandler) formats.push("json");
      if (a.sseHandler) formats.push("sse");
      return {
        name: a.name,
        description: a.description,
        defaultFormat: a.defaultFormat,
        formats,
        toolNames: a.toolNames,
        hasPromptOverride: await ctx.agents.hasPromptOverride(a.name),
        actions: a.actions?.map((act) => `${act.method.toUpperCase()} /${a.name}/${act.name}`),
        ...(a.isOrchestrator && { isOrchestrator: true }),
        ...(a.agents && { agents: a.agents }),
      };
    }));
    return c.json({ agents, count: agents.length });
  });

  // POST /cancel — Cancel an active agent stream
  router.post("/cancel", async (c) => {
    const { conversationId } = await c.req.json();
    const cancelled = cancelRequest(conversationId);
    return c.json({ cancelled, conversationId });
  });

  // GET /:agentName — Get agent details
  router.get("/:agentName", async (c) => {
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
      systemPrompt: await ctx.agents.getResolvedPrompt(name) ?? "",
      isDefault: !(await ctx.agents.hasPromptOverride(name)),
      actions: agent.actions?.map((act) => ({
        name: act.name, method: act.method, summary: act.summary, description: act.description,
      })),
    });
  });

  // PATCH /:agentName — Update system prompt
  router.patch("/:agentName", async (c) => {
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
      systemPrompt: await ctx.agents.getResolvedPrompt(name) ?? "",
      isDefault: !(await ctx.agents.hasPromptOverride(name)),
    });
  });

  // POST /:agentName/:action — Agent actions
  router.post("/:agentName/:action", async (c) => {
    const agentName = c.req.param("agentName");
    const actionName = c.req.param("action");
    const agent = ctx.agents.get(agentName);
    if (!agent) return c.json({ error: `Agent not found: ${agentName}` }, 404);
    const action = agent.actions?.find((a) => a.name === actionName);
    if (!action) return c.json({ error: `Action not found: ${actionName} on agent ${agentName}` }, 404);
    return action.handler(c as any);
  });

  // POST /:agentName — Dynamic dispatch
  router.post("/:agentName", async (c) => {
    const name = c.req.param("agentName");
    const agent = ctx.agents.get(name);
    if (!agent) return c.json({ error: `Agent not found: ${name}` }, 404);

    const format = (c.req.query("format") ?? agent.defaultFormat) as "json" | "sse";
    const handler = format === "sse" ? agent.sseHandler : agent.jsonHandler;

    if (!handler) {
      const supported = [agent.jsonHandler && "json", agent.sseHandler && "sse"].filter(Boolean);
      return c.json({ error: `Agent "${name}" does not support format "${format}". Supported: ${supported.join(", ")}` }, 400);
    }

    const scopeId = c.req.header("X-Scope-Id") || undefined;
    const systemPrompt = await ctx.agents.getResolvedPrompt(name) ?? "";
    const body = await c.req.json();

    let memoryContext: string | undefined;
    if (body.memoryIds && Array.isArray(body.memoryIds) && body.memoryIds.length > 0) {
      try {
        const memories = await ctx.storage.memory.loadMemoriesForIds(body.memoryIds, scopeId);
        if (memories.length > 0) {
          memoryContext = memories.map((m) => `[${m.namespace}] ${m.key}: ${m.value}`).join("\n");
        }
      } catch { /* memory loading may fail */ }
    }

    if (format === "sse") {
      const bus = new AgentEventBus();
      const delegationCtx: DelegationContext = { chain: [], depth: 0, events: bus, orchestrator: name };
      return delegationStore.run(delegationCtx, () => handler(c.req, { systemPrompt, memoryContext, body }));
    }

    return handler(c.req, { systemPrompt, memoryContext, body });
  });

  return router;
}
