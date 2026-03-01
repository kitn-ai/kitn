import { needsCompaction, compactConversation } from "./compaction.js";
import { emitStatus } from "../events/emit-status.js";
import { STATUS_CODES } from "../events/events.js";
import type { PluginContext } from "../types.js";

/**
 * Load conversation history with optional auto-compaction.
 *
 * - Loads the conversation from storage
 * - If auto-compaction is enabled and token limit exceeded, compacts then reloads
 * - Appends the new user message to the store
 * - Returns the history messages array, or undefined if conversation not found
 */
export async function loadConversationWithCompaction(
  ctx: PluginContext,
  conversationId: string,
  newUserMessage: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }> | undefined> {
  emitStatus({ code: STATUS_CODES.LOADING_CONTEXT, message: "Loading conversation history", metadata: { conversationId } });
  let conv = await ctx.storage.conversations.get(conversationId);
  if (!conv) {
    // First message for this conversation — persist so subsequent requests find it
    await ctx.storage.conversations.append(conversationId, {
      role: "user",
      content: newUserMessage,
      timestamp: new Date().toISOString(),
    });
    return undefined;
  }

  // Auto-compact if enabled and token limit exceeded
  const compactionConfig = ctx.config.compaction;
  if (compactionConfig?.enabled !== false && compactionConfig && needsCompaction(conv, compactionConfig.tokenLimit)) {
    await compactConversation(ctx, conversationId);
    conv = await ctx.storage.conversations.get(conversationId);
    if (!conv) return undefined;
  }

  // Append user message
  await ctx.storage.conversations.append(conversationId, {
    role: "user",
    content: newUserMessage,
    timestamp: new Date().toISOString(),
  });

  return [
    ...conv.messages.map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: newUserMessage },
  ];
}
