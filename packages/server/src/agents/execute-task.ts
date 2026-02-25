import { tool } from "ai";
import { z } from "zod";
import type { UsageInfo } from "../lib/ai-provider.js";
import { runAgent } from "../lib/run-agent.js";
import {
  delegationStore,
  getEventBus,
  getOrchestratorAgents,
  type DelegationContext,
} from "../lib/delegation-context.js";
import { TOOL_NAMES, DEFAULTS } from "../lib/constants.js";
import { BUS_EVENTS, STATUS_CODES } from "../lib/events.js";
import { emitStatus } from "../lib/emit-status.js";
import type { PluginContext } from "../context.js";
import { createMemoryTool, getDefaultMemoryStore } from "./memory-tool.js";

const clarifyItemSchema = z.object({
  type: z.enum(["question", "option", "confirmation", "action", "warning", "info"]),
  text: z.string(),
  choices: z.array(z.string()).optional().describe("Required when type is 'option'"),
  context: z.string().optional(),
});

export type ClarifyItem = z.infer<typeof clarifyItemSchema>;

const CLARIFY_TOOL = tool({
  description:
    "Use when you need information, confirmation, or approval from the user. " +
    "Supports: question (free text), option (pick from choices), " +
    "confirmation (yes/no), action (declare intent), warning (risk), info (status update). " +
    "Only use when you genuinely cannot proceed without user interaction.",
  inputSchema: z.object({ items: z.array(clarifyItemSchema) }),
});

const MEMORY_PROMPT_SUFFIX =
  "\n\nYou have access to a memory tool for storing and retrieving information. " +
  "Use it to remember important facts, user preferences, or intermediate results. " +
  "Actions: set (save), get (retrieve by key), list (show all), delete (remove).";

const CLARIFY_PROMPT_SUFFIX =
  "\n\nIMPORTANT: If the user's query is vague or lacks specifics needed to give a good answer, " +
  "you MUST use the clarify tool to ask for more information. Do NOT guess, do NOT ask in plain text, " +
  "and do NOT proceed without the needed details. Call clarify with items like: " +
  '{items: [{type: "question", text: "Your question here", context: "Why you need this"}]}.';

export interface TaskResult {
  agent: string;
  query: string;
  result: {
    response: string;
    items?: ClarifyItem[];
    toolsUsed: string[];
    usage?: UsageInfo;
  };
  responseSkills?: string[];
}

function errorResult(agent: string, query: string, message: string): TaskResult {
  return { agent, query, result: { response: message, toolsUsed: [] } };
}

export async function executeTask(
  ctx: PluginContext,
  agent: string,
  query: string,
  skills?: string[],
): Promise<TaskResult> {
  const registration = ctx.agents.get(agent);
  if (!registration) return errorResult(agent, query, `Unknown agent: ${agent}`);

  if (getOrchestratorAgents(ctx.agents).has(agent)) {
    return errorResult(agent, query, `Agent "${agent}" is an orchestrator and cannot be delegated to`);
  }

  if (!registration.tools || Object.keys(registration.tools).length === 0) {
    return errorResult(agent, query, `Agent "${agent}" does not support task execution`);
  }

  const parentCtx = delegationStore.getStore();
  const chain = parentCtx?.chain ?? [];
  const depth = parentCtx?.depth ?? 0;

  if (depth >= ctx.maxDelegationDepth) {
    return errorResult(agent, query, `Delegation depth limit (${ctx.maxDelegationDepth}) exceeded. Chain: ${chain.join(" → ")} → ${agent}`);
  }

  if (chain.length > 0 && chain[chain.length - 1] === agent) {
    return errorResult(agent, query, `Self-delegation blocked: "${agent}" cannot delegate to itself`);
  }

  if (chain.includes(agent)) {
    return errorResult(agent, query, `Circular delegation blocked: ${chain.join(" → ")} → ${agent}`);
  }

  const bus = getEventBus();
  const from = chain.length > 0 ? chain[chain.length - 1] : (parentCtx?.orchestrator ?? agent);

  let systemPrompt = ctx.agents.getResolvedPrompt(agent)!;
  const querySkillNames: string[] = [];
  const responseSkillNames: string[] = [];

  if (skills && skills.length > 0) {
    const skillSections: string[] = [];
    for (const skillName of skills) {
      const skill = await ctx.storage.skills.getSkill(skillName);
      if (!skill) continue;
      if (skill.phase === "query" || skill.phase === "both") {
        skillSections.push(`### ${skill.name}\n${skill.content}`);
        querySkillNames.push(skill.name);
      }
      if (skill.phase === "response" || skill.phase === "both") {
        responseSkillNames.push(skill.name);
      }
    }
    if (skillSections.length > 0) {
      systemPrompt += `\n\n# Active Skills\nApply the following behavioral instructions to your response:\n\n${skillSections.join("\n\n")}`;
    }
  }

  if (querySkillNames.length > 0) {
    bus?.emit(BUS_EVENTS.SKILL_INJECT, { agent, skills: querySkillNames, phase: "query" });
  }
  bus?.emit(BUS_EVENTS.DELEGATE_START, { from, to: agent, query });

  const childCtx: DelegationContext = {
    chain: [...chain, agent],
    depth: depth + 1,
    events: parentCtx?.events,
    abortSignal: parentCtx?.abortSignal,
  };

  const augmentedTools: Record<string, any> = {
    ...registration.tools!,
    [TOOL_NAMES.CLARIFY]: CLARIFY_TOOL,
  };
  if (!registration.disableMemoryTool) {
    augmentedTools[TOOL_NAMES.MEMORY] = createMemoryTool(getDefaultMemoryStore(), agent);
  }

  // Invoke guard if present
  if (registration.guard) {
    emitStatus({ code: STATUS_CODES.GUARD_CHECK, message: "Running pre-execution guard", agent });
    const guardResult = await registration.guard(query, agent);
    if (!guardResult.allowed) {
      bus?.emit(BUS_EVENTS.DELEGATE_END, {
        from, to: agent, summary: `Blocked: ${guardResult.reason ?? "guard rejected"}`, error: true,
      });
      return errorResult(agent, query, `Guard blocked: ${guardResult.reason ?? "query not allowed"}`);
    }
  }

  let augmentedSystem = systemPrompt + CLARIFY_PROMPT_SUFFIX;
  if (!registration.disableMemoryTool) {
    augmentedSystem += MEMORY_PROMPT_SUFFIX;
  }

  try {
    bus?.emit(BUS_EVENTS.AGENT_START, { agent });
    emitStatus({ code: STATUS_CODES.PROCESSING, message: "Agent starting work", agent });
    const result = await delegationStore.run(childCtx, () =>
      runAgent(ctx, { system: augmentedSystem, tools: augmentedTools, agentName: agent }, query)
    );

    bus?.emit(BUS_EVENTS.AGENT_END, { agent });
    bus?.emit(BUS_EVENTS.DELEGATE_END, { from, to: agent, summary: result.response.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) });

    return {
      agent,
      query,
      result,
      ...(responseSkillNames.length > 0 && { responseSkills: responseSkillNames }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    bus?.emit(BUS_EVENTS.AGENT_END, { agent, error: message.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT) });
    bus?.emit(BUS_EVENTS.DELEGATE_END, { from, to: agent, summary: `Error: ${message.slice(0, DEFAULTS.SUMMARY_LENGTH_LIMIT)}`, error: true });
    return errorResult(agent, query, `Agent execution failed: ${message}`);
  }
}
