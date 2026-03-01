import { generateText } from "ai";
import { withResilience } from "./resilience.js";
import { DEFAULTS } from "./constants.js";
import { estimateTokens, estimateMessageTokens } from "./token-estimate.js";
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
 * Check if a conversation exceeds the compaction token limit.
 */
export function needsCompaction(conversation: Conversation, tokenLimit?: number): boolean {
  const limit = tokenLimit ?? DEFAULTS.COMPACTION_TOKEN_LIMIT;
  return estimateMessageTokens(conversation.messages) > limit;
}

/**
 * Split messages into [toSummarize, toPreserve] based on a token budget.
 * Walks from newest to oldest, accumulating tokens until preserveTokens is reached.
 */
function splitByTokenBudget(
  messages: ConversationMessage[],
  preserveTokens: number,
): [ConversationMessage[], ConversationMessage[]] {
  let budget = preserveTokens;
  let splitIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i].content);
    if (budget - tokens < 0) break;
    budget -= tokens;
    splitIndex = i;
  }

  // Always preserve at least the last message
  if (splitIndex === messages.length && messages.length > 0) {
    splitIndex = messages.length - 1;
  }

  return [messages.slice(0, splitIndex), messages.slice(splitIndex)];
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
 * Uses token-based budgeting to determine what to preserve vs. summarize.
 * Includes overflow recovery: if post-compaction is still too large,
 * progressively reduces preserved messages, then truncates as last resort.
 */
export async function compactConversation(
  ctx: PluginContext,
  conversationId: string,
  configOverride?: { preserveTokens?: number; prompt?: string; model?: string; tokenLimit?: number },
): Promise<CompactionResult | null> {
  const config = ctx.config.compaction;
  const preserveTokens = configOverride?.preserveTokens ?? config?.preserveTokens ?? DEFAULTS.COMPACTION_PRESERVE_TOKENS;
  const tokenLimit = configOverride?.tokenLimit ?? config?.tokenLimit ?? DEFAULTS.COMPACTION_TOKEN_LIMIT;
  const prompt = configOverride?.prompt ?? config?.prompt ?? DEFAULT_COMPACTION_PROMPT;
  const model = configOverride?.model ?? config?.model;

  const conversation = await ctx.storage.conversations.get(conversationId);
  if (!conversation) return null;

  const messages = conversation.messages;

  const [toSummarize, toPreserve] = splitByTokenBudget(messages, preserveTokens);

  // Nothing to summarize — all messages fit in the preserve budget
  if (toSummarize.length === 0) {
    return { summary: "", summarizedCount: 0, preservedCount: messages.length, newMessageCount: messages.length };
  }

  const formatted = formatMessagesForSummary(toSummarize);
  const fullPrompt = `${prompt}\n\n---\n\n${formatted}`;

  emitStatus({
    code: STATUS_CODES.COMPACTING,
    message: "Compacting conversation history",
    metadata: { conversationId, summarizedCount: toSummarize.length, preservedCount: toPreserve.length },
  });

  const result = await withResilience({
    fn: (overrideModel) =>
      generateText({
        model: ctx.model(overrideModel ?? model),
        prompt: fullPrompt,
      }),
    ctx,
    modelId: model,
  });

  let summary = result.text;

  // ── Overflow recovery ──
  let currentPreserved = [...toPreserve];
  let totalTokens = estimateTokens(summary) + estimateMessageTokens(currentPreserved);

  // Progressive reduction: drop oldest preserved messages one at a time
  while (totalTokens > tokenLimit && currentPreserved.length > 1) {
    currentPreserved = currentPreserved.slice(1);
    totalTokens = estimateTokens(summary) + estimateMessageTokens(currentPreserved);
  }

  // Hard truncation: if summary alone exceeds limit, truncate it
  if (totalTokens > tokenLimit) {
    const availableForSummary = tokenLimit - estimateMessageTokens(currentPreserved);
    if (availableForSummary > 0) {
      const maxChars = availableForSummary * 4;
      summary = summary.slice(0, maxChars);
    }
  }

  // Rebuild conversation
  await ctx.storage.conversations.clear(conversationId);

  await ctx.storage.conversations.append(conversationId, {
    role: "assistant",
    content: summary,
    timestamp: new Date().toISOString(),
    metadata: { [COMPACTION_METADATA_KEY]: true, summarizedCount: toSummarize.length },
  });

  for (const msg of currentPreserved) {
    await ctx.storage.conversations.append(conversationId, msg);
  }

  return {
    summary,
    summarizedCount: toSummarize.length,
    preservedCount: currentPreserved.length,
    newMessageCount: 1 + currentPreserved.length,
  };
}
