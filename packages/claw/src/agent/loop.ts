import { runAgent } from "@kitnai/core";
import type { PluginContext, ConversationMessage } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { PermissionManager } from "../permissions/manager.js";
import { wrapToolsWithPermissions, type PermissionHandler } from "./wrapped-tools.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCallInfo[];
}

export interface AgentLoopOptions {
  ctx: PluginContext;
  config: ClawConfig;
  sessionId: string;
  channelType: string;
  permissions: PermissionManager;
  permissionHandler: PermissionHandler;
}

/**
 * Run one turn of the agent loop for a given session.
 *
 * 1. Load conversation history from session store
 * 2. Build system prompt with context
 * 3. Wrap tools with permission checks
 * 4. Call runAgent with messages
 * 5. Persist messages to session
 * 6. Return structured response
 */
export async function runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions,
): Promise<AgentResponse> {
  const { ctx, config, sessionId, channelType, permissions, permissionHandler } = options;

  // 1. Load conversation history
  const conversation = await ctx.storage.conversations.get(sessionId);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (conversation) {
    for (const msg of conversation.messages) {
      history.push({ role: msg.role, content: msg.content });
    }
  }

  // 2. Add current user message
  history.push({ role: "user", content: userMessage });

  // Persist user message
  await ctx.storage.conversations.append(sessionId, {
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  // 3. Build system prompt
  const system = await buildSystemPrompt(ctx, config, channelType);

  // 4. Wrap tools with permissions
  const wrappedTools = wrapToolsWithPermissions(ctx, permissions, permissionHandler);

  // 5. Set up tool call capture via lifecycle hooks
  const toolCalls: ToolCallInfo[] = [];
  let unsubscribe: (() => void) | undefined;
  if (ctx.hooks) {
    unsubscribe = ctx.hooks.on("tool:execute", (event) => {
      toolCalls.push({
        name: event.toolName,
        input: event.input,
        result: event.output,
      });
    });
  }

  // 6. Run the agent
  const result = await runAgent(
    ctx,
    { system, tools: wrappedTools, agentName: "kitnclaw" },
    history,
  );

  // Clean up hook listener
  unsubscribe?.();

  // 7. Persist assistant response (tool call details now include full input/output)
  const assistantMessage: ConversationMessage = {
    role: "assistant",
    content: result.response,
    timestamp: new Date().toISOString(),
    metadata: toolCalls.length > 0 ? { toolCalls } : undefined,
  };
  await ctx.storage.conversations.append(sessionId, assistantMessage);

  return {
    text: result.response,
    toolCalls,
  };
}
