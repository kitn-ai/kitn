import { streamText, stepCountIs } from "ai";
import { createSSEStream } from "./sse-writer.js";
import { extractStreamUsage } from "../utils/ai-provider.js";
import { getEventBus, getAbortSignal } from "../utils/delegation-context.js";
import { registerRequest, unregisterRequest } from "../utils/request-registry.js";
import { SSE_EVENTS, BUS_EVENTS, STATUS_CODES } from "../events/events.js";
import type { PluginContext } from "../types.js";

interface AgentStreamConfig {
  system: string;
  // AI SDK tool type is opaque and not directly expressible — `any` required here
  tools: Record<string, any>;
  prompt?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  maxSteps?: number;
  conversationId: string;
  agentName?: string;
  extraDoneData?: Record<string, unknown>;
  onStreamComplete?: (result: { text: string; toolCalls: string[] }) => Promise<void>;
}

export function streamAgentResponse(ctx: PluginContext, config: AgentStreamConfig) {
  const startTime = performance.now();
  let abortSignal = getAbortSignal();
  if (!abortSignal) {
    const controller = registerRequest(config.conversationId);
    abortSignal = controller.signal;
  }
  const promptOrMessages = config.messages
    ? { messages: [{ role: "system" as const, content: config.system }, ...config.messages] }
    : { system: config.system, prompt: config.prompt! };

  const result = streamText({
    model: ctx.model(config.model),
    ...promptOrMessages,
    tools: config.tools,
    stopWhen: stepCountIs(config.maxSteps ?? ctx.defaultMaxSteps),
    abortSignal,
  });

  return createSSEStream(async (writer) => {
    let id = 0;
    const toolsUsed = new Set<string>();
    const bus = getEventBus();
    let fullText = "";

    await writer.writeSSE({
      id: String(id++),
      event: SSE_EVENTS.SESSION_START,
      data: JSON.stringify({ conversationId: config.conversationId }),
    });

    await writer.writeSSE({
      id: String(id++),
      event: SSE_EVENTS.STATUS,
      data: JSON.stringify({ code: STATUS_CODES.PROCESSING, message: "Agent starting work", agent: config.agentName }),
    });

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          fullText += chunk.text;
          bus?.emit(BUS_EVENTS.TEXT_DELTA, { text: chunk.text });
          await writer.writeSSE({
            id: String(id++),
            event: SSE_EVENTS.TEXT_DELTA,
            data: JSON.stringify({ text: chunk.text }),
          });
        } else if (chunk.type === "tool-call") {
          toolsUsed.add(chunk.toolName);
          bus?.emit(BUS_EVENTS.TOOL_CALL, { agent: config.agentName, tool: chunk.toolName, args: chunk.input });
          await writer.writeSSE({
            id: String(id++),
            event: SSE_EVENTS.TOOL_CALL,
            data: JSON.stringify({
              agent: config.agentName,
              toolName: chunk.toolName,
              args: chunk.input,
            }),
          });
        } else if (chunk.type === "tool-result") {
          bus?.emit(BUS_EVENTS.TOOL_RESULT, { agent: config.agentName, tool: chunk.toolName, result: chunk.output });
          await writer.writeSSE({
            id: String(id++),
            event: SSE_EVENTS.TOOL_RESULT,
            data: JSON.stringify({
              agent: config.agentName,
              toolName: chunk.toolName,
              result: chunk.output,
            }),
          });
        }
      }

      if (config.onStreamComplete) {
        await config.onStreamComplete({ text: fullText, toolCalls: [...toolsUsed] });
      }

      const usage = await result.usage;
      const usageInfo = extractStreamUsage(usage, startTime);

      await writer.writeSSE({
        id: String(id++),
        event: SSE_EVENTS.DONE,
        data: JSON.stringify({
          toolsUsed: [...toolsUsed],
          conversationId: config.conversationId,
          usage: usageInfo,
          ...config.extraDoneData,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === "AbortError" || abortSignal?.aborted) {
        await writer.writeSSE({
          id: String(id++),
          event: SSE_EVENTS.CANCELLED,
          data: JSON.stringify({ conversationId: config.conversationId }),
        });
      } else {
        await writer.writeSSE({
          id: String(id++),
          event: SSE_EVENTS.ERROR,
          data: JSON.stringify({ conversationId: config.conversationId, error: message }),
        });
      }
    } finally {
      unregisterRequest(config.conversationId);
    }
  }, abortSignal);
}
