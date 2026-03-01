import type { ConversationMessage } from "../storage/interfaces.js";

/**
 * Estimate token count for a string using a ~4 chars/token heuristic.
 * Fast, zero-dependency approximation suitable for compaction thresholds.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens across an array of conversation messages.
 */
export function estimateMessageTokens(messages: Pick<ConversationMessage, "content">[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
  }
  return total;
}
