/** Data shape returned by card extractors */
export interface CardData {
  type: string;
  data: Record<string, unknown>;
}

/**
 * A function that inspects a tool result and optionally returns card data.
 * Return `null` if the extractor does not apply to this tool/result.
 */
export type CardExtractor = (toolName: string, result: unknown) => CardData | null;

/**
 * Pluggable registry for extracting UI card data from tool results.
 *
 * Host applications register extractors that inspect tool results and produce
 * typed card data (e.g. weather cards, link previews). The orchestrator uses this
 * during streaming to collect cards without hardcoding tool-specific logic.
 *
 * @example
 * ```ts
 * const cards = new CardRegistry();
 * cards.register((toolName, result) => {
 *   if (toolName === "getWeather" && result?.location) {
 *     return { type: "weather", data: result };
 *   }
 *   return null;
 * });
 * ```
 */
export class CardRegistry {
  private extractors: CardExtractor[] = [];

  /** Register a card extractor. Returns an unsubscribe function. */
  register(extractor: CardExtractor): () => void {
    this.extractors.push(extractor);
    return () => {
      const idx = this.extractors.indexOf(extractor);
      if (idx !== -1) this.extractors.splice(idx, 1);
    };
  }

  /** Run all extractors against a tool result and return any produced cards. */
  extract(toolName: string, result: unknown): CardData[] {
    const cards: CardData[] = [];
    for (const extractor of this.extractors) {
      const card = extractor(toolName, result);
      if (card) cards.push(card);
    }
    return cards;
  }
}
