import { generateText } from "ai";
import { withResilience } from "./resilience.js";
import { DEFAULTS } from "./constants.js";
import { emitStatus } from "../events/emit-status.js";
import { STATUS_CODES } from "../events/events.js";
import type { PluginContext } from "../types.js";
import type { Conversation, ConversationMessage } from "../storage/interfaces.js";

export const COMPACTION_METADATA_KEY = "_compaction";

const DEFAULT_COMPACTION_PROMPT = `You are a conversation summarizer. Given the following conversation messages, create a concise but comprehensive summary that preserves:
- Key facts, decisions, and outcomes
- User preferences and context established
- Important tool results and their implications
- Any ongoing tasks or commitments

Output ONLY the summary text, no preamble or formatting.`;

export interface CompactionResult {
  summary: string;
  summarizedCount: number;
  preservedCount: number;
  newMessageCount: number;
}

/**
 * Check if a conversation exceeds the compaction threshold.
 */
export function needsCompaction(conversation: Conversation, threshold?: number): boolean {
  const limit = threshold ?? DEFAULTS.COMPACTION_THRESHOLD;
  return conversation.messages.length > limit;
}

function formatMessagesForSummary(messages: ConversationMessage[]): string {
  return messages
    .map((m) => {
      const prefix = m.metadata?.[COMPACTION_METADATA_KEY] ? "[Previous Summary]" : m.role;
      return `${prefix}: ${m.content}`;
    })
    .join("\n\n");
}

/**
 * Compact a conversation by summarizing older messages with an LLM call.
 * Preserves the most recent N messages as-is.
 */
export async function compactConversation(
  ctx: PluginContext,
  conversationId: string,
  configOverride?: { preserveRecent?: number; prompt?: string; model?: string },
): Promise<CompactionResult | null> {
  const config = ctx.config.compaction;
  const preserveRecent = configOverride?.preserveRecent ?? config?.preserveRecent ?? DEFAULTS.COMPACTION_PRESERVE_RECENT;
  const prompt = configOverride?.prompt ?? config?.prompt ?? DEFAULT_COMPACTION_PROMPT;
  const model = configOverride?.model ?? config?.model;

  const conversation = await ctx.storage.conversations.get(conversationId);
  if (!conversation) return null;

  const messages = conversation.messages;
  if (messages.length <= preserveRecent) {
    return { summary: "", summarizedCount: 0, preservedCount: messages.length, newMessageCount: messages.length };
  }

  const toSummarize = messages.slice(0, messages.length - preserveRecent);
  const toPreserve = messages.slice(messages.length - preserveRecent);

  const formatted = formatMessagesForSummary(toSummarize);
  const fullPrompt = `${prompt}\n\n---\n\n${formatted}`;

  emitStatus({ code: STATUS_CODES.COMPACTING, message: "Compacting conversation history", metadata: { conversationId, summarizedCount: toSummarize.length, preservedCount: toPreserve.length } });

  const result = await withResilience({
    fn: (overrideModel) =>
      generateText({
        model: ctx.getModel(overrideModel ?? model),
        prompt: fullPrompt,
      }),
    ctx,
    modelId: model,
  });

  const summary = result.text;

  // Clear and rebuild conversation with summary + preserved messages
  await ctx.storage.conversations.clear(conversationId);

  // Write the summary as a compaction message
  await ctx.storage.conversations.append(conversationId, {
    role: "assistant",
    content: summary,
    timestamp: new Date().toISOString(),
    metadata: { [COMPACTION_METADATA_KEY]: true, summarizedCount: toSummarize.length },
  });

  // Write preserved messages back
  for (const msg of toPreserve) {
    await ctx.storage.conversations.append(conversationId, msg);
  }

  return {
    summary,
    summarizedCount: toSummarize.length,
    preservedCount: toPreserve.length,
    newMessageCount: 1 + toPreserve.length,
  };
}
