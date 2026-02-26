import type { AgentRequest } from "../types.js";
import type { PluginContext } from "../types.js";
import type { AgentHandler } from "./agent-registry.js";
import { loadConversationWithCompaction } from "../utils/conversation-helpers.js";

export function generateConversationId(existing?: string) {
  return existing ?? `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface RegistryHandlerConfig {
  tools: Record<string, any>;
  maxSteps?: number;
}

export function makeRegistryStreamHandler(config: RegistryHandlerConfig, ctx: PluginContext): AgentHandler {
  return async (req: AgentRequest, { systemPrompt, memoryContext, body: preParsedBody }) => {
    const { streamAgentResponse } = await import("../streaming/stream-helpers.js");
    const body = preParsedBody ?? await req.json<any>();
    const { message, messages, conversationId: cid, model } = body;
    const convId = generateConversationId(cid);

    const system = memoryContext
      ? `${systemPrompt}\n\n## Memory Context\n${memoryContext}`
      : systemPrompt;

    // If a conversationId is provided, load history (with auto-compaction) from the store
    let historyMessages: Array<{ role: "user" | "assistant"; content: string }> | undefined;
    if (cid) {
      historyMessages = await loadConversationWithCompaction(ctx, cid, message);
    }

    const promptOrMessages = historyMessages
      ? { messages: historyMessages }
      : messages
        ? { messages }
        : { prompt: message };

    return streamAgentResponse(ctx, {
      system,
      tools: config.tools,
      ...promptOrMessages,
      model,
      maxSteps: config.maxSteps,
      conversationId: convId,
      onStreamComplete: cid
        ? async ({ text }) => {
            if (text) {
              await ctx.storage.conversations.append(cid, {
                role: "assistant",
                content: text,
                timestamp: new Date().toISOString(),
              });
            }
          }
        : undefined,
    });
  };
}

export function makeRegistryJsonHandler(config: RegistryHandlerConfig, ctx: PluginContext): AgentHandler {
  return async (req: AgentRequest, { systemPrompt, memoryContext, body: preParsedBody }) => {
    const { runAgent } = await import("../agents/run-agent.js");
    const body = preParsedBody ?? await req.json<any>();
    const { message, conversationId: cid, model } = body;

    const system = memoryContext
      ? `${systemPrompt}\n\n## Memory Context\n${memoryContext}`
      : systemPrompt;

    const result = await runAgent(
      ctx,
      { system, tools: config.tools },
      message,
      model,
      config.maxSteps,
    );
    return new Response(JSON.stringify({ ...result, conversationId: generateConversationId(cid) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

export function makeRegistryHandlers(config: RegistryHandlerConfig, ctx: PluginContext) {
  return {
    sseHandler: makeRegistryStreamHandler(config, ctx),
    jsonHandler: makeRegistryJsonHandler(config, ctx),
  };
}
