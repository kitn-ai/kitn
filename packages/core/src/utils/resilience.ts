import type { PluginContext } from "../types.js";
import { emitStatus } from "../events/emit-status.js";
import { STATUS_CODES } from "../events/events.js";

interface ResilienceOptions<T> {
  /** The LLM call to wrap. Receives an optional override model ID. */
  fn: (modelId?: string) => Promise<T>;
  /** Plugin context — reads resilience config from ctx.config.resilience */
  ctx: PluginContext;
  /** Agent name for fallback context */
  agent?: string;
  /** Current model ID */
  modelId?: string;
  /** AbortSignal to respect cancellation */
  abortSignal?: AbortSignal;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

/**
 * Classifies whether an error is retryable.
 * Retryable: 429, 500-504, timeouts, network errors, "overloaded"/"capacity".
 * Not retryable: AbortError, auth errors (401/403), validation errors (400/422).
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Never retry abort
  if (error.name === "AbortError") return false;

  const message = error.message.toLowerCase();

  // Check for status codes in the error
  const statusMatch = message.match(/\b(\d{3})\b/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (RETRYABLE_STATUS_CODES.has(status)) return true;
    // Non-retryable status codes
    if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
  }

  // Check for status property on error object
  const errRecord = error as unknown as Record<string, unknown>;
  const statusProp = errRecord.status ?? errRecord.statusCode;
  if (typeof statusProp === "number") {
    if (RETRYABLE_STATUS_CODES.has(statusProp)) return true;
    if (NON_RETRYABLE_STATUS_CODES.has(statusProp)) return false;
  }

  // Timeout and network errors
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up")
  ) {
    return true;
  }

  // Provider capacity errors
  if (message.includes("overloaded") || message.includes("capacity")) {
    return true;
  }

  // Rate limit keywords
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return true;
  }

  return false;
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterFactor: number): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = exponential * jitterFactor * Math.random();
  return exponential + jitter;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }, { once: true });
  });
}

/**
 * Generic retry wrapper for LLM calls with exponential backoff and fallback.
 *
 * Reads config from `ctx.config.resilience`. On retryable errors, retries up to
 * `maxRetries` with exponential backoff + jitter. When retries exhaust, calls
 * `onFallback()` if provided. If fallback returns a model ID, tries once more.
 */
export async function withResilience<T>(opts: ResilienceOptions<T>): Promise<T> {
  const { fn, ctx, agent, modelId, abortSignal } = opts;
  const config = ctx.config.resilience;

  const maxRetries = config?.maxRetries ?? 3;
  const baseDelayMs = config?.baseDelayMs ?? 1000;
  const maxDelayMs = config?.maxDelayMs ?? 30000;
  const jitterFactor = config?.jitterFactor ?? 0.2;
  const onFallback = config?.onFallback;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Never retry aborts
      if (lastError.name === "AbortError" || abortSignal?.aborted) {
        throw lastError;
      }

      // Don't retry non-retryable errors
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Last attempt before fallback
      if (attempt === maxRetries) {
        break;
      }

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      emitStatus({ code: STATUS_CODES.RETRYING, message: `Retrying (attempt ${attempt + 1}/${maxRetries})`, agent, metadata: { attempt: attempt + 1, maxRetries, delay } });
      await sleep(delay, abortSignal);
    }
  }

  // Retries exhausted — try fallback
  if (onFallback && lastError) {
    emitStatus({ code: STATUS_CODES.FALLBACK, message: "Switching to fallback model", agent, metadata: { currentModel: modelId ?? "default" } });
    const fallbackModel = await onFallback({
      agent,
      currentModel: modelId ?? "default",
      retryCount: maxRetries,
      error: lastError,
    });

    if (fallbackModel) {
      return await fn(fallbackModel);
    }
  }

  throw lastError!;
}
