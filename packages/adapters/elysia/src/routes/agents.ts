import { Elysia } from "elysia";
import type { PluginContext, DelegationContext } from "@kitnai/core";
import { AgentEventBus, delegationStore, cancelRequest } from "@kitnai/core";
import { toAgentRequest } from "../adapters/request-adapter.js";

export function createAgentsRoutes(ctx: PluginContext) {
  return new Elysia({ prefix: "/agents" })
    .get("/", async () => {
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
      return { agents, count: agents.length };
    })
    .post("/cancel", async ({ body }) => {
      const { conversationId } = body as any;
      const cancelled = cancelRequest(conversationId);
      return { cancelled, conversationId };
    })
    .get("/:agentName", async ({ params, status }) => {
      const name = params.agentName;
      const agent = ctx.agents.get(name);
      if (!agent) return status(404, { error: `Agent not found: ${name}` });

      const formats: string[] = [];
      if (agent.jsonHandler) formats.push("json");
      if (agent.sseHandler) formats.push("sse");

      return {
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
      };
    })
    .patch("/:agentName", async ({ params, body, status }) => {
      const name = params.agentName;
      const agent = ctx.agents.get(name);
      if (!agent) return status(404, { error: `Agent not found: ${name}` });

      const b = body as any;
      if (b.reset) {
        ctx.agents.resetPrompt(name);
        await ctx.storage.prompts.deleteOverride(name);
      } else if (b.system) {
        ctx.agents.setPromptOverride(name, b.system);
        await ctx.storage.prompts.saveOverride(name, b.system);
      }

      return {
        name,
        systemPrompt: await ctx.agents.getResolvedPrompt(name) ?? "",
        isDefault: !(await ctx.agents.hasPromptOverride(name)),
      };
    })
    .post("/:agentName/:action", async ({ params, status, request }) => {
      const { agentName, action: actionName } = params;
      const agent = ctx.agents.get(agentName);
      if (!agent) return status(404, { error: `Agent not found: ${agentName}` });
      const action = agent.actions?.find((a) => a.name === actionName);
      if (!action) return status(404, { error: `Action not found: ${actionName} on agent ${agentName}` });
      return action.handler(request as any);
    })
    .post("/:agentName", async ({ params, query, headers, body, request, status }) => {
      const name = params.agentName;
      const agent = ctx.agents.get(name);
      if (!agent) return status(404, { error: `Agent not found: ${name}` });

      const format = (query.format ?? agent.defaultFormat) as "json" | "sse";
      const handler = format === "sse" ? agent.sseHandler : agent.jsonHandler;

      if (!handler) {
        const supported = [agent.jsonHandler && "json", agent.sseHandler && "sse"].filter(Boolean);
        return status(400, { error: `Agent "${name}" does not support format "${format}". Supported: ${supported.join(", ")}` });
      }

      const scopeId = headers["x-scope-id"] || undefined;
      const systemPrompt = await ctx.agents.getResolvedPrompt(name) ?? "";
      const b = body as any;

      let memoryContext: string | undefined;
      if (b.memoryIds && Array.isArray(b.memoryIds) && b.memoryIds.length > 0) {
        try {
          const memories = await ctx.storage.memory.loadMemoriesForIds(b.memoryIds, scopeId);
          if (memories.length > 0) {
            memoryContext = memories.map((m) => `[${m.namespace}] ${m.key}: ${m.value}`).join("\n");
          }
        } catch { /* memory loading may fail */ }
      }

      const agentReq = toAgentRequest({ body: b, query: query as Record<string, string | undefined>, params, headers: headers as Record<string, string | undefined>, request });

      if (format === "sse") {
        const bus = new AgentEventBus();
        const delegationCtx: DelegationContext = { chain: [], depth: 0, events: bus, orchestrator: name };
        return delegationStore.run(delegationCtx, () => handler(agentReq, { systemPrompt, memoryContext, body: b }));
      }

      return handler(agentReq, { systemPrompt, memoryContext, body: b });
    });
}
