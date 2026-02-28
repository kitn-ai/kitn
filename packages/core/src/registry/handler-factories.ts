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
  agentName?: string;
}

export function makeRegistryStreamHandler(config: RegistryHandlerConfig, ctx: PluginContext): AgentHandler {
  return async (req: AgentRequest, { systemPrompt, memoryContext, body: preParsedBody }) => {
    const startTime = performance.now();
    const agentName = config.agentName ?? "unknown";
    const scopeId = req.header("x-scope-id") ?? undefined;

    const { streamAgentResponse } = await import("../streaming/stream-helpers.js");
    const body = preParsedBody ?? await req.json<any>();
    const { message, messages, conversationId: cid, model } = body;
    const convId = generateConversationId(cid);

    const system = memoryContext
      ? `${systemPrompt}\n\n## Memory Context\n${memoryContext}`
      : systemPrompt;

    // Load history from existing conversation, or save first user message to new conversation
    let historyMessages: Array<{ role: "user" | "assistant"; content: string }> | undefined;
    if (cid) {
      historyMessages = await loadConversationWithCompaction(ctx, cid, message);
    } else if (message) {
      await ctx.storage.conversations.append(convId, {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });
    }

    const promptOrMessages = historyMessages
      ? { messages: historyMessages }
      : messages
        ? { messages }
        : { prompt: message };

    ctx.hooks?.emit("agent:start", {
      agentName,
      input: message,
      conversationId: convId,
      scopeId,
      timestamp: Date.now(),
    });

    return streamAgentResponse(ctx, {
      system,
      tools: config.tools,
      ...promptOrMessages,
      model,
      maxSteps: config.maxSteps,
      conversationId: convId,
      onStreamComplete: async ({ text, toolCalls }) => {
        if (text) {
          await ctx.storage.conversations.append(convId, {
            role: "assistant",
            content: text,
            timestamp: new Date().toISOString(),
          });
        }
        ctx.hooks?.emit("agent:end", {
          agentName,
          input: message,
          output: text,
          toolsUsed: toolCalls,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          duration: performance.now() - startTime,
          conversationId: convId,
          scopeId,
          timestamp: Date.now(),
        });
      },
    });
  };
}

export function makeRegistryJsonHandler(config: RegistryHandlerConfig, ctx: PluginContext): AgentHandler {
  return async (req: AgentRequest, { systemPrompt, memoryContext, body: preParsedBody }) => {
    const startTime = performance.now();
    const { runAgent } = await import("../agents/run-agent.js");
    const body = preParsedBody ?? await req.json<any>();
    const { message, conversationId: cid, model } = body;
    const convId = generateConversationId(cid);
    const agentName = config.agentName ?? "unknown";
    const scopeId = req.header("x-scope-id") ?? undefined;

    const system = memoryContext
      ? `${systemPrompt}\n\n## Memory Context\n${memoryContext}`
      : systemPrompt;

    // Persist user message
    if (cid) {
      await loadConversationWithCompaction(ctx, cid, message);
    } else if (message) {
      await ctx.storage.conversations.append(convId, {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });
    }

    ctx.hooks?.emit("agent:start", {
      agentName,
      input: message,
      conversationId: convId,
      scopeId,
      timestamp: Date.now(),
    });

    try {
      const result = await runAgent(
        ctx,
        { system, tools: config.tools },
        message,
        model,
        config.maxSteps,
      );

      // Persist assistant response
      if (result.response) {
        await ctx.storage.conversations.append(convId, {
          role: "assistant",
          content: result.response,
          timestamp: new Date().toISOString(),
        });
      }

      ctx.hooks?.emit("agent:end", {
        agentName,
        input: message,
        output: result.response ?? "",
        toolsUsed: result.toolsUsed,
        usage: {
          promptTokens: result.usage.inputTokens,
          completionTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
        duration: performance.now() - startTime,
        conversationId: convId,
        scopeId,
        timestamp: Date.now(),
      });

      return new Response(JSON.stringify({ ...result, conversationId: convId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      ctx.hooks?.emit("agent:error", {
        agentName,
        input: message,
        error: err instanceof Error ? err.message : String(err),
        duration: performance.now() - startTime,
        conversationId: convId,
        scopeId,
        timestamp: Date.now(),
      });
      throw err;
    }
  };
}

export function makeRegistryHandlers(config: RegistryHandlerConfig, ctx: PluginContext) {
  return {
    sseHandler: makeRegistryStreamHandler(config, ctx),
    jsonHandler: makeRegistryJsonHandler(config, ctx),
  };
}
