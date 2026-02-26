import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createSSEStream } from "../streaming/sse-writer.js";
import type { AgentRequest } from "../types.js";
import { extractUsage, extractStreamUsage, mergeUsage, type UsageInfo } from "../utils/ai-provider.js";
import { executeTask, type TaskResult } from "./execute-task.js";
import { generateConversationId } from "../registry/handler-factories.js";
import { getOrchestratorAgents, getEventBus, getAbortSignal, delegationStore } from "../utils/delegation-context.js";
import { registerRequest, cancelRequest, unregisterRequest } from "../utils/request-registry.js";
import { SSE_EVENTS, BUS_EVENTS, BUS_TO_SSE_MAP, FORWARDED_BUS_EVENTS, STATUS_CODES } from "../events/events.js";
import { writeStatus } from "../events/emit-status.js";
import { TOOL_NAMES, DEFAULTS } from "../utils/constants.js";
import { withResilience } from "../utils/resilience.js";
import { loadConversationWithCompaction } from "../utils/conversation-helpers.js";
import type { CardData } from "../utils/card-registry.js";
import type { CardRegistry } from "../utils/card-registry.js";
import type { AgentEventBus } from "../events/agent-events.js";
import type { PluginContext } from "../types.js";
import type { AgentRegistration } from "../registry/agent-registry.js";

async function executeTasksSettled(
  ctx: PluginContext,
  tasks: { agent: string; query: string; skills?: string[] }[],
): Promise<TaskResult[]> {
  const settled = await Promise.allSettled(
    tasks.map((t) => executeTask(ctx, t.agent, t.query, t.skills))
  );
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      agent: tasks[i].agent,
      query: tasks[i].query,
      result: { response: `Task failed: ${(s.reason as Error)?.message ?? "Unknown error"}`, toolsUsed: [] },
    };
  });
}

export const DEFAULT_ORCHESTRATOR_PROMPT = `You are an orchestrator agent that routes user queries to the appropriate specialist agent.

When you receive a query:
1. Analyze what the user is asking about
2. Consider if any available skills would improve the response quality
3. For simple, single-domain queries: use routeToAgent to delegate immediately
4. For complex, multi-domain queries: use createTask for each sub-task (they will run in parallel)
5. Synthesize the results into a coherent response

Guidelines for choosing between routeToAgent and createTask:
- Use routeToAgent when the query maps to a single agent or when tasks must be sequential
- Use createTask when the query spans multiple independent domains that can run in parallel
- You can mix both in a single response if needed

Guidelines for skill selection:
- Only attach skills when they clearly match the user's intent or phrasing
- Don't attach skills when they would not meaningfully change the response
- You may attach multiple skills if they complement each other
- Each skill has a phase (query/response/both) — this is handled automatically, just select the right skills

Always use the routing tools - never answer domain questions directly.`;

export interface OrchestratorAgentConfig {
  name: string;
  description?: string;
  systemPrompt?: string;
  agents?: string[];
  autonomous?: boolean;
}

// ── Serialized stream writer
interface StreamWriter {
  write(event: string, data: Record<string, unknown>): Promise<void>;
  flush(): Promise<void>;
}

function createStreamWriter(stream: { writeSSE: (msg: any) => Promise<void> }): StreamWriter {
  let id = 0;
  let chain = Promise.resolve();
  return {
    write(event: string, data: Record<string, unknown>) {
      const p = chain.then(() => stream.writeSSE({ id: String(id++), event, data: JSON.stringify(data) }));
      chain = p.catch(() => {});
      return p;
    },
    flush() { return chain; },
  };
}

function bridgeBusToStream(bus: AgentEventBus | undefined, writer: StreamWriter, cardRegistry: CardRegistry): { unsub: () => void; cards: CardData[] } {
  const cards: CardData[] = [];
  if (!bus) return { unsub: () => {}, cards };

  const unsub = bus.subscribe((event) => {
    if (!FORWARDED_BUS_EVENTS.has(event.type)) return;
    const sseEvent = BUS_TO_SSE_MAP[event.type] ?? event.type;
    let data = event.data;
    if (event.type === BUS_EVENTS.TOOL_CALL && data.tool && !data.toolName) data = { ...data, toolName: data.tool };
    if (event.type === BUS_EVENTS.TOOL_RESULT && data.tool && !data.toolName) data = { ...data, toolName: data.tool };
    if (event.type === BUS_EVENTS.TOOL_RESULT) {
      const rec = data as Record<string, unknown>;
      const toolName = (rec.toolName ?? rec.tool) as string;
      const result = rec.result;
      const extracted = cardRegistry.extract(toolName, result);
      cards.push(...extracted);
    }
    writer.write(sseEvent, data);
  });

  return { unsub, cards };
}

// ── Synthesis helpers

interface SynthesisSource {
  label: string;
  response: string;
}

function taskResultsToSources(results: TaskResult[]): SynthesisSource[] {
  return results.map((r, i) => ({ label: `Task ${i + 1} (${r.agent})`, response: r.result.response }));
}

function buildSynthesisPrompt(sources: SynthesisSource[], userMessage: string): string {
  const body = sources.map(s => `${s.label}:\n${s.response}`).join("\n\n");
  return `Here are the results from the specialist agent(s):\n\n${body}\n\nPlease synthesize these results into a coherent, comprehensive response for the user's original query: "${userMessage}"`;
}

async function synthesizeStreaming(opts: {
  ctx: PluginContext; model: string | undefined; sources: SynthesisSource[];
  userMessage: string; skillNames: string[]; writer: StreamWriter;
  agentName: string; abortSignal?: AbortSignal;
}): Promise<{ text: string; usage: UsageInfo }> {
  const { ctx, model, sources, userMessage, skillNames, writer, agentName, abortSignal } = opts;
  const synthesisSystem = await buildSynthesisContext(ctx, skillNames);
  if (skillNames.length > 0) await writer.write(SSE_EVENTS.SKILL_INJECT, { agent: agentName, skills: skillNames, phase: "response" });
  await writeStatus(writer, { code: STATUS_CODES.SYNTHESIZING, message: "Combining results", agent: agentName });
  await writer.write(SSE_EVENTS.AGENT_THINK, { text: DEFAULTS.SYNTHESIS_MESSAGE });
  const prompt = buildSynthesisPrompt(sources, userMessage);
  const synthesisStart = performance.now();
  const synthesisResult = streamText({ model: ctx.model(model), ...(synthesisSystem && { system: synthesisSystem }), prompt, abortSignal });
  let fullText = "";
  for await (const text of synthesisResult.textStream) { fullText += text; await writer.write(SSE_EVENTS.TEXT_DELTA, { text }); }
  const synthesisUsage = await synthesisResult.usage;
  return { text: fullText, usage: extractStreamUsage(synthesisUsage, synthesisStart) };
}

async function synthesizeJson(opts: {
  ctx: PluginContext; model: string | undefined; sources: SynthesisSource[];
  userMessage: string; skillNames: string[]; agentName: string; bus?: AgentEventBus;
}): Promise<{ text: string; usage: UsageInfo }> {
  const { ctx, model, sources, userMessage, skillNames, agentName, bus } = opts;
  const synthesisSystem = await buildSynthesisContext(ctx, skillNames);
  if (skillNames.length > 0) bus?.emit(BUS_EVENTS.SKILL_INJECT, { agent: agentName, skills: skillNames, phase: "response" });
  const prompt = buildSynthesisPrompt(sources, userMessage);
  const synthesisStart = performance.now();
  const synthesisResult = await withResilience({
    fn: (overrideModel) => generateText({ model: ctx.model(overrideModel ?? model), ...(synthesisSystem && { system: synthesisSystem }), prompt }),
    ctx, agent: agentName, modelId: model,
  });
  return { text: synthesisResult.text, usage: extractUsage(synthesisResult, synthesisStart) };
}

// ── Agent helpers
function getRoutableAgents(ctx: PluginContext, allowedAgents?: string[]) {
  const orchestrators = getOrchestratorAgents(ctx.agents);
  return ctx.agents.list().filter((a) => {
    if (orchestrators.has(a.name)) return false;
    if (!a.tools || Object.keys(a.tools).length === 0) return false;
    if (allowedAgents) return allowedAgents.includes(a.name);
    return true;
  });
}

function buildRoutingTool(ctx: PluginContext, allowedAgents?: string[]) {
  const agents = getRoutableAgents(ctx, allowedAgents);
  if (agents.length === 0) throw new Error("No routable agents available");
  const agentNames = agents.map((a) => a.name) as [string, ...string[]];

  return tool({
    description: "Route a query to a specialist agent for immediate execution.",
    inputSchema: z.object({
      agent: z.enum(agentNames).describe("The specialist agent to route to"),
      query: z.string().describe("The query to send to the agent"),
      skills: z.array(z.string()).optional().describe("Skill names to activate"),
    }),
    execute: async ({ agent, query, skills }) => {
      const taskResult = await executeTask(ctx, agent, query, skills);
      return { ...taskResult.result, [DEFAULTS.RESPONSE_SKILLS_KEY]: taskResult.responseSkills ?? [] };
    },
  });
}

function buildCreateTaskTool(ctx: PluginContext, allowedAgents?: string[]) {
  const agents = getRoutableAgents(ctx, allowedAgents);
  if (agents.length === 0) throw new Error("No routable agents available");
  const agentNames = agents.map((a) => a.name) as [string, ...string[]];

  return tool({
    description: "Create a sub-task to be delegated to a specialist agent. Tasks run in parallel.",
    inputSchema: z.object({
      agent: z.enum(agentNames).describe("The specialist agent"),
      query: z.string().describe("The specific query"),
      skills: z.array(z.string()).optional().describe("Skill names to activate"),
    }),
  });
}

async function buildSystemPrompt(ctx: PluginContext, basePrompt: string, allowedAgents?: string[]) {
  const agents = getRoutableAgents(ctx, allowedAgents);
  const agentList = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  let prompt = `${basePrompt}\n\nAvailable agents:\n${agentList}`;
  const skillSummaries = await ctx.storage.skills.getSkillSummaries();
  prompt += `\n\nAvailable skills (pass skill names in the "skills" parameter when routing):\n${skillSummaries}`;
  return prompt;
}

function collectTasksFromSteps(steps: Array<{ toolCalls: Array<{ toolName: string }> }>): { agent: string; query: string; skills?: string[] }[] {
  const tasks: { agent: string; query: string; skills?: string[] }[] = [];
  for (const step of steps) {
    for (const tc of step.toolCalls) {
      // AI SDK v6 ToolCall type doesn't expose `.input` directly
      const input = (tc as unknown as { input: Record<string, unknown> }).input;
      if (tc.toolName === TOOL_NAMES.CREATE_TASK && input) {
        const typed = input as { agent?: string; query?: string; skills?: string[] };
        if (typed.agent && typed.query) tasks.push({ agent: typed.agent, query: typed.query, skills: typed.skills });
      }
    }
  }
  return tasks;
}

function collectResponseSkills(results: TaskResult[]): string[] {
  const all = results.flatMap((r) => r.responseSkills ?? []);
  return [...new Set(all)];
}

async function buildSynthesisContext(ctx: PluginContext, skillNames: string[]): Promise<string | undefined> {
  if (skillNames.length === 0) return undefined;
  const sections: string[] = [];
  for (const name of [...new Set(skillNames)]) {
    const skill = await ctx.storage.skills.getSkill(name);
    if (skill) sections.push(`### ${skill.name}\n${skill.content}`);
  }
  if (sections.length === 0) return undefined;
  return `# Active Skills\nApply the following behavioral instructions to your response:\n\n${sections.join("\n\n")}`;
}

// ── SSE Handler ──────────────────────────────────────
function buildSseHandler(ctx: PluginContext, agentName: string, allowedAgents?: string[], defaultAutonomous = true) {
  return async (req: AgentRequest, { systemPrompt, memoryContext }: { systemPrompt: string; memoryContext?: string }) => {
    const body = await req.json<any>();
    const { message, conversationId: cid, model, planMode, approvedPlan, autonomous: reqAutonomous } = body;
    const convId = generateConversationId(cid);
    const autonomous = reqAutonomous ?? defaultAutonomous;
    const overallStart = performance.now();

    const controller = registerRequest(convId);
    const abortSignal = controller.signal;
    req.raw.signal.addEventListener("abort", () => cancelRequest(convId));
    const parentCtx = delegationStore.getStore();
    const delCtx = { ...parentCtx!, abortSignal };

    let system = await buildSystemPrompt(ctx, systemPrompt, allowedAgents);
    if (memoryContext) system += `\n\n## Memory Context\n${memoryContext}`;

    let historyMessages: Array<{ role: "user" | "assistant"; content: string }> | undefined;
    if (cid) {
      historyMessages = await loadConversationWithCompaction(ctx, cid, message);
    }

    async function saveAssistantResponse(text: string, cards?: CardData[]) {
      if (cid && text) {
        await ctx.storage.conversations.append(cid, { role: "assistant", content: text, timestamp: new Date().toISOString(), ...(cards?.length ? { metadata: { cards } } : {}) });
      }
    }

    // approvedPlan shortcut
    if (approvedPlan && Array.isArray(approvedPlan) && approvedPlan.length > 0) {
      return createSSEStream(async (writer) => {
        return delegationStore.run(delCtx, async () => {
          const swriter = createStreamWriter(writer);
          const bus = getEventBus();
          const { unsub, cards: collectedCards } = bridgeBusToStream(bus, swriter, ctx.cards);
          await swriter.write(SSE_EVENTS.SESSION_START, { conversationId: convId });
          try {
            await swriter.write(SSE_EVENTS.AGENT_START, { agent: agentName });
            await writeStatus(swriter, { code: STATUS_CODES.EXECUTING_TASKS, message: "Executing approved plan tasks", agent: agentName });
            const results = await executeTasksSettled(ctx, approvedPlan.map((task: any) => ({ agent: task.agent, query: task.query, skills: task.skills })));
            await swriter.flush();
            const responseSkills = collectResponseSkills(results);
            const sources = taskResultsToSources(results);
            const { text: fullText, usage: synthUsageInfo } = await synthesizeStreaming({
              ctx, model, sources, userMessage: message, skillNames: responseSkills,
              writer: swriter, agentName, abortSignal,
            });
            await saveAssistantResponse(fullText, collectedCards);
            const subAgentUsages = results.map((r) => r.result.usage).filter((u): u is UsageInfo => !!u);
            const totalUsage = mergeUsage(...subAgentUsages, synthUsageInfo);
            totalUsage.durationMs = Math.round(performance.now() - overallStart);
            await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
            await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [...new Set(results.flatMap((r) => r.result.toolsUsed))], conversationId: convId, tasks: results.map((r) => ({ agent: r.agent, query: r.query, summary: r.result.response.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) })), usage: totalUsage });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const errName = err instanceof Error ? err.name : undefined;
            if (errName === "AbortError" || abortSignal?.aborted) {
              await swriter.write(SSE_EVENTS.CANCELLED, { conversationId: convId });
            } else {
              console.error(`[orchestrator:${agentName}] approvedPlan SSE error:`, message);
              await swriter.write(SSE_EVENTS.ERROR, { conversationId: convId, error: message });
            }
          } finally { unregisterRequest(convId); unsub(); }
        });
      }, abortSignal);
    }

    // AI SDK tool type is opaque and not directly expressible — `any` required here
    const tools: Record<string, any> = {};
    if (planMode) {
      tools[TOOL_NAMES.CREATE_TASK] = buildCreateTaskTool(ctx, allowedAgents);
    } else {
      tools[TOOL_NAMES.ROUTE_TO_AGENT] = buildRoutingTool(ctx, allowedAgents);
      tools[TOOL_NAMES.CREATE_TASK] = buildCreateTaskTool(ctx, allowedAgents);
    }

    return createSSEStream(async (writer) => {
      return delegationStore.run(delCtx, async () => {
        const swriter = createStreamWriter(writer);
        const bus = getEventBus();
        const { unsub, cards: collectedCards } = bridgeBusToStream(bus, swriter, ctx.cards);
        await swriter.write(SSE_EVENTS.SESSION_START, { conversationId: convId });
        try {
          await swriter.write(SSE_EVENTS.AGENT_START, { agent: agentName });
          await writeStatus(swriter, { code: STATUS_CODES.THINKING, message: "Analyzing query and routing", agent: agentName });
          const planStart = performance.now();
          const planResult = await withResilience({
            fn: (overrideModel) => generateText({
              model: ctx.model(overrideModel ?? model), system,
              ...(historyMessages ? { messages: historyMessages.map(m => ({ role: m.role, content: m.content })) } : { prompt: message }),
              tools, stopWhen: stepCountIs(ctx.defaultMaxSteps), abortSignal,
            }),
            ctx, agent: agentName, modelId: model, abortSignal,
          });
          const planUsage = extractUsage(planResult, planStart);
          await swriter.flush();

          // Reactive clarification check
          if (!autonomous) {
            for (const step of planResult.steps) {
              for (const tr of step.toolResults) {
                if (tr.toolName === TOOL_NAMES.ROUTE_TO_AGENT) {
                  const output = (tr as any).output;
                  if (output?.items?.length) {
                    const agent = (planResult.steps.flatMap((s) => s.toolCalls).find((tc) => tc.toolName === TOOL_NAMES.ROUTE_TO_AGENT)?.input as any)?.agent;
                    const taggedItems = output.items.map((item: any) => ({ ...item, agent }));
                    await swriter.write(SSE_EVENTS.ASK_USER, { items: taggedItems });
                    await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
                    const subAgentUsage = output?.usage as UsageInfo | undefined;
                    const totalUsage = subAgentUsage ? mergeUsage(planUsage, subAgentUsage) : { ...planUsage };
                    totalUsage.durationMs = Math.round(performance.now() - overallStart);
                    await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [TOOL_NAMES.ROUTE_TO_AGENT], conversationId: convId, awaitingResponse: true, items: taggedItems, usage: totalUsage });
                    return;
                  }
                }
              }
            }
          }

          const tasks = collectTasksFromSteps(planResult.steps);

          if (tasks.length > 0) {
            await writeStatus(swriter, { code: STATUS_CODES.PLANNING, message: "Building task plan", agent: agentName });
            await swriter.write(SSE_EVENTS.AGENT_PLAN, { tasks });
            if (!autonomous) {
              await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
              await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [TOOL_NAMES.CREATE_TASK], conversationId: convId, awaitingApproval: true, tasks, usage: { ...planUsage, durationMs: Math.round(performance.now() - overallStart) } });
              return;
            }
            await writeStatus(swriter, { code: STATUS_CODES.EXECUTING_TASKS, message: "Executing parallel tasks", agent: agentName });
            const results = await executeTasksSettled(ctx, tasks);
            await swriter.flush();
            const responseSkills = collectResponseSkills(results);
            const sources = taskResultsToSources(results);
            const { text: fullText, usage: synthUsageInfo } = await synthesizeStreaming({
              ctx, model, sources, userMessage: message, skillNames: responseSkills,
              writer: swriter, agentName, abortSignal,
            });
            await saveAssistantResponse(fullText, collectedCards);
            const subAgentUsages = results.map((r) => r.result.usage).filter((u): u is UsageInfo => !!u);
            const totalUsage = mergeUsage(planUsage, ...subAgentUsages, synthUsageInfo);
            totalUsage.durationMs = Math.round(performance.now() - overallStart);
            await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
            await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [...new Set(results.flatMap((r) => r.result.toolsUsed))], conversationId: convId, tasks: results.map((r) => ({ agent: r.agent, query: r.query, summary: r.result.response.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) })), usage: totalUsage });
            return;
          }

          // Direct mode
          const routeResults = planResult.steps.flatMap((step) => step.toolResults).filter((tr) => tr.toolName === TOOL_NAMES.ROUTE_TO_AGENT);
          if (routeResults.length > 0) {
            const responseSkills = [...new Set(routeResults.flatMap((tr) => (tr as any).output?.[DEFAULTS.RESPONSE_SKILLS_KEY] ?? []))];
            const sources: SynthesisSource[] = routeResults.map((tr, i) => {
              const output = (tr as any).output;
              const resolved = output ?? (tr as any).result;
              const response = resolved?.response ?? "";
              return { label: `Result ${i + 1}`, response };
            });
            const { text: fullText, usage: synthUsageInfo } = await synthesizeStreaming({
              ctx, model, sources, userMessage: message, skillNames: responseSkills,
              writer: swriter, agentName, abortSignal,
            });
            await saveAssistantResponse(fullText, collectedCards);
            const routeToolsUsed = routeResults.flatMap((tr) => (tr as any).output?.toolsUsed ?? []);
            const subAgentUsages = routeResults.map((tr) => (tr as any).output?.usage).filter((u): u is UsageInfo => !!u);
            const totalUsage = mergeUsage(planUsage, ...subAgentUsages, synthUsageInfo);
            totalUsage.durationMs = Math.round(performance.now() - overallStart);
            await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
            await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [...new Set([TOOL_NAMES.ROUTE_TO_AGENT, ...routeToolsUsed])], conversationId: convId, usage: totalUsage });
          } else {
            if (planResult.text) { await swriter.write(SSE_EVENTS.TEXT_DELTA, { text: planResult.text }); await saveAssistantResponse(planResult.text, collectedCards); }
            await swriter.write(SSE_EVENTS.AGENT_END, { agent: agentName });
            await swriter.write(SSE_EVENTS.DONE, { toolsUsed: [...new Set(planResult.steps.flatMap((step) => step.toolCalls).map((tc) => tc.toolName))], conversationId: convId, usage: { ...planUsage, durationMs: Math.round(performance.now() - overallStart) } });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const errName = err instanceof Error ? err.name : undefined;
          if (errName === "AbortError" || abortSignal.aborted) {
            await swriter.write(SSE_EVENTS.CANCELLED, { conversationId: convId });
          } else {
            console.error(`[orchestrator:${agentName}] SSE error:`, message);
            await swriter.write(SSE_EVENTS.ERROR, { conversationId: convId, error: message });
          }
        } finally { unregisterRequest(convId); unsub(); }
      });
    }, abortSignal);
  };
}

// ── JSON handler
function buildJsonHandler(ctx: PluginContext, agentName: string, allowedAgents?: string[], defaultAutonomous = true) {
  return async (req: AgentRequest, { systemPrompt, memoryContext }: { systemPrompt: string; memoryContext?: string }) => {
    const body = await req.json<any>();
    const { message, conversationId: cid, model, approvedPlan, autonomous: reqAutonomous } = body;
    const autonomous = reqAutonomous ?? defaultAutonomous;

    if (approvedPlan && Array.isArray(approvedPlan) && approvedPlan.length > 0) {
      const overallStart = performance.now();
      const results = await executeTasksSettled(ctx, approvedPlan.map((task: any) => ({ agent: task.agent, query: task.query, skills: task.skills })));
      const responseSkills = collectResponseSkills(results);
      const sources = taskResultsToSources(results);
      const { text, usage: synthUsage } = await synthesizeJson({
        ctx, model, sources, userMessage: message, skillNames: responseSkills,
        agentName, bus: getEventBus(),
      });
      const subAgentUsages = results.map((r) => r.result.usage).filter((u): u is UsageInfo => !!u);
      const totalUsage = mergeUsage(...subAgentUsages, synthUsage);
      totalUsage.durationMs = Math.round(performance.now() - overallStart);
      return new Response(JSON.stringify({ response: text, toolsUsed: [...new Set(results.flatMap((r) => r.result.toolsUsed))], tasks: results.map((r) => ({ agent: r.agent, query: r.query, summary: r.result.response.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) })), conversationId: generateConversationId(cid), usage: totalUsage }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build system prompt including agent+skill summaries
    let system = await buildSystemPrompt(ctx, systemPrompt, allowedAgents);
    if (memoryContext) system += `\n\n## Memory Context\n${memoryContext}`;

    const startTime = performance.now();
    const routeToAgentTool = buildRoutingTool(ctx, allowedAgents);
    const createTaskTool = buildCreateTaskTool(ctx, allowedAgents);

    const result = await withResilience({
      fn: (overrideModel) => generateText({
        model: ctx.model(overrideModel ?? model), system, prompt: message,
        tools: { [TOOL_NAMES.ROUTE_TO_AGENT]: routeToAgentTool, [TOOL_NAMES.CREATE_TASK]: createTaskTool },
        stopWhen: stepCountIs(ctx.defaultMaxSteps), abortSignal: getAbortSignal(),
      }),
      ctx, agent: agentName, modelId: model, abortSignal: getAbortSignal(),
    });

    // Handle deferred createTask calls
    const tasks = collectTasksFromSteps(result.steps);
    if (tasks.length > 0) {
      const results = await executeTasksSettled(ctx, tasks);
      const responseSkills = collectResponseSkills(results);
      const sources = taskResultsToSources(results);
      const { text, usage: synthUsage } = await synthesizeJson({
        ctx, model, sources, userMessage: message, skillNames: responseSkills,
        agentName,
      });
      const orchestratorUsage = extractUsage(result, startTime);
      const subAgentUsages = results.map((r) => r.result.usage).filter((u): u is UsageInfo => !!u);
      const totalUsage = mergeUsage(orchestratorUsage, ...subAgentUsages, synthUsage);
      totalUsage.durationMs = Math.round(performance.now() - startTime);
      return new Response(JSON.stringify({ response: text, toolsUsed: [...new Set(results.flatMap((r) => r.result.toolsUsed))], agentsUsed: [...new Set(results.map((r) => r.agent))], tasks: results.map((r) => ({ agent: r.agent, query: r.query, summary: r.result.response.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) })), conversationId: generateConversationId(cid), usage: totalUsage }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Direct routeToAgent path
    const orchestratorUsage = extractUsage(result, startTime);
    const routeResultUsages = result.steps.flatMap((step) => step.toolResults).filter((tr) => tr.toolName === TOOL_NAMES.ROUTE_TO_AGENT).map((tr) => (tr as any).output?.usage).filter((u): u is UsageInfo => !!u);
    const toolsUsed = result.steps.flatMap((step) => step.toolCalls).map((tc) => tc.toolName);
    const agentsUsed = result.steps.flatMap((step) => step.toolCalls).map((tc) => (tc as any).input).filter((input): input is { agent: string } => !!input?.agent).map((args) => args.agent);

    return new Response(JSON.stringify({
      response: result.text,
      toolsUsed: [...new Set(toolsUsed)],
      agentsUsed: [...new Set(agentsUsed)],
      conversationId: generateConversationId(cid),
      usage: routeResultUsages.length > 0 ? mergeUsage(orchestratorUsage, ...routeResultUsages) : orchestratorUsage,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/**
 * Factory: creates and registers an orchestrator agent on the given plugin context.
 * Returns the AgentRegistration for further customization.
 */
export function createOrchestratorAgent(ctx: PluginContext, config: OrchestratorAgentConfig): AgentRegistration {
  const {
    name,
    description = "Unified orchestrator agent that routes queries directly or creates parallel task plans",
    systemPrompt = DEFAULT_ORCHESTRATOR_PROMPT,
    agents,
    autonomous = true,
  } = config;

  const registration: AgentRegistration = {
    name,
    description,
    toolNames: [TOOL_NAMES.ROUTE_TO_AGENT, TOOL_NAMES.CREATE_TASK],
    defaultFormat: "sse",
    defaultSystem: systemPrompt,
    isOrchestrator: true,
    agents,
    sseHandler: buildSseHandler(ctx, name, agents, autonomous),
    jsonHandler: buildJsonHandler(ctx, name, agents, autonomous),
  };

  ctx.agents.register(registration);
  return registration;
}
