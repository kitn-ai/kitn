export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  durationMs: number;
}

/**
 * Extract usage, cost, and timing from an AI SDK v6 result.
 * - Prefers `totalUsage` (aggregated across steps) over `usage` (last step only)
 * - Extracts cost from each step's `usage.raw.cost` (OpenRouter-specific)
 * - Requires `startTime` from `performance.now()` to compute duration
 */
export function extractUsage(
  result: { totalUsage?: any; usage?: any; steps?: any[] },
  startTime: number,
): UsageInfo {
  const u = result.totalUsage ?? result.usage;
  const inputTokens = u?.inputTokens ?? 0;
  const outputTokens = u?.outputTokens ?? 0;
  const totalTokens = u?.totalTokens ?? (inputTokens + outputTokens);
  const durationMs = Math.round(performance.now() - startTime);

  let cost: number | null = null;
  if (result.steps && result.steps.length > 0) {
    let total = 0;
    let found = false;
    for (const step of result.steps) {
      const stepCost = step.usage?.raw?.cost;
      if (typeof stepCost === "number") {
        total += stepCost;
        found = true;
      }
    }
    if (found) cost = total;
  } else {
    const rawCost = u?.raw?.cost;
    if (typeof rawCost === "number") cost = rawCost;
  }

  return { inputTokens, outputTokens, totalTokens, cost, durationMs };
}

/**
 * Build a UsageInfo from a streaming result's awaited `usage` promise.
 */
export function extractStreamUsage(
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; raw?: { cost?: number } } | undefined,
  startTime: number,
): UsageInfo {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? (inputTokens + outputTokens);
  const rawCost = usage?.raw?.cost;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cost: typeof rawCost === "number" ? rawCost : null,
    durationMs: Math.round(performance.now() - startTime),
  };
}

/**
 * Merge multiple UsageInfo objects into one (for task agent aggregation).
 */
export function mergeUsage(...usages: UsageInfo[]): UsageInfo {
  const merged: UsageInfo = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: null,
    durationMs: 0,
  };

  for (const u of usages) {
    merged.inputTokens += u.inputTokens;
    merged.outputTokens += u.outputTokens;
    merged.totalTokens += u.totalTokens;
    if (u.cost !== null) {
      merged.cost = (merged.cost ?? 0) + u.cost;
    }
    if (u.durationMs > merged.durationMs) {
      merged.durationMs = u.durationMs;
    }
  }

  return merged;
}
