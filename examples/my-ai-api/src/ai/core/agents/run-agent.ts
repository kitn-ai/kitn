import { generateText, stepCountIs } from "ai";
import { extractUsage } from "../utils/ai-provider.js";
import { getEventBus, getAbortSignal } from "../utils/delegation-context.js";
import { TOOL_NAMES } from "../utils/constants.js";
import { BUS_EVENTS } from "../events/events.js";
import { withResilience } from "../utils/resilience.js";

const BUILT_IN_TOOLS: Set<string> = new Set([TOOL_NAMES.CLARIFY, TOOL_NAMES.MEMORY]);
import type { ClarifyItem } from "./execute-task.js";
import type { PluginContext } from "../types.js";

interface AgentConfig {
  system: string;
  // AI SDK tool type is opaque and not directly expressible — `any` required here
  tools: Record<string, any>;
  agentName?: string;
}

export async function runAgent(
  ctx: PluginContext,
  config: AgentConfig,
  message: string,
  model?: string,
  maxSteps = ctx.defaultMaxSteps,
) {
  const startTime = performance.now();
  const abortSignal = getAbortSignal();
  const result = await withResilience({
    fn: (overrideModel) => generateText({
      model: ctx.getModel(overrideModel ?? model),
      system: config.system,
      prompt: message,
      tools: config.tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal,
    }),
    ctx,
    agent: config.agentName,
    modelId: model,
    abortSignal,
  });

  const toolsUsed = result.steps
    .flatMap((step) => step.toolCalls)
    .map((tc) => tc.toolName)
    .filter((t) => !BUILT_IN_TOOLS.has(t));

  const bus = getEventBus();
  if (bus) {
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        if (!BUILT_IN_TOOLS.has(tc.toolName)) {
          // AI SDK v6 ToolCall type doesn't expose `.input` directly
          const tcInput = (tc as unknown as { input: Record<string, unknown> }).input;
          bus.emit(BUS_EVENTS.TOOL_CALL, { agent: config.agentName, tool: tc.toolName, args: tcInput });
        }
      }
      for (const tr of step.toolResults) {
        if (!BUILT_IN_TOOLS.has(tr.toolName)) {
          // AI SDK v6 ToolResult type doesn't expose `.output` directly
          const trOutput = (tr as unknown as { output: unknown }).output;
          bus.emit(BUS_EVENTS.TOOL_RESULT, { agent: config.agentName, tool: tr.toolName, result: trOutput });
        }
      }
    }
  }

  const items: ClarifyItem[] = [];
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      if (tc.toolName === TOOL_NAMES.CLARIFY) {
        // AI SDK v6 ToolCall type doesn't expose `.input` directly
        const input = (tc as unknown as { input: { items?: ClarifyItem[]; questions?: Array<Record<string, unknown>> } }).input;
        if (!input) continue;
        if (input.items?.length) {
          items.push(...input.items);
        } else if (input.questions?.length) {
          for (const q of input.questions) {
            const text = (q.question ?? q.text ?? String(q)) as string;
            const context = q.context as string | undefined;
            items.push({
              type: "question",
              text,
              ...(context ? { context } : {}),
            });
          }
        }
      }
    }
  }

  return {
    response: result.text,
    ...(items.length > 0 && { items }),
    toolsUsed: [...new Set(toolsUsed)],
    usage: extractUsage(result, startTime),
  };
}
