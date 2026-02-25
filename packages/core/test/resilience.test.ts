/**
 * Resilience utility tests (isRetryableError, withResilience).
 * Run with: bun test packages/core/test/resilience.test.ts
 */
import { describe, test, expect } from "bun:test";
import { isRetryableError, withResilience } from "../src/utils/resilience.js";

describe("isRetryableError", () => {
  test("retries on 429 (rate limit)", () => {
    const err = Object.assign(new Error("Rate limit 429"), { status: 429 });
    expect(isRetryableError(err)).toBe(true);
  });

  test("retries on 500 (server error)", () => {
    const err = Object.assign(new Error("Server error 500"), { status: 500 });
    expect(isRetryableError(err)).toBe(true);
  });

  test("retries on timeout message", () => {
    expect(isRetryableError(new Error("Request timed out"))).toBe(true);
  });

  test("retries on overloaded message", () => {
    expect(isRetryableError(new Error("Model is overloaded"))).toBe(true);
  });

  test("does not retry on 401 (unauthorized)", () => {
    const err = Object.assign(new Error("Unauthorized 401"), { status: 401 });
    expect(isRetryableError(err)).toBe(false);
  });

  test("does not retry on 400 (bad request)", () => {
    const err = Object.assign(new Error("Bad request 400"), { status: 400 });
    expect(isRetryableError(err)).toBe(false);
  });

  test("does not retry on AbortError", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isRetryableError(err)).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isRetryableError("string")).toBe(false);
  });
});

describe("withResilience", () => {
  test("retries on retryable error and eventually succeeds", async () => {
    let attempts = 0;
    const mockCtx = {
      config: { resilience: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterFactor: 0 } },
    } as any;

    const result = await withResilience({
      fn: async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error("Rate limit 429"), { status: 429 });
        return "success";
      },
      ctx: mockCtx,
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("calls onFallback when retries are exhausted", async () => {
    let fallbackCalled = false;
    const mockCtx = {
      config: {
        resilience: {
          maxRetries: 1,
          baseDelayMs: 10,
          maxDelayMs: 50,
          jitterFactor: 0,
          onFallback: async (context: any) => {
            fallbackCalled = true;
            expect(context.retryCount).toBe(1);
            expect(context.currentModel).toBe("test-model");
            return "fallback-model";
          },
        },
      },
    } as any;

    let lastModelOverride: string | undefined;
    const result = await withResilience({
      fn: async (overrideModel) => {
        lastModelOverride = overrideModel;
        if (!overrideModel) throw Object.assign(new Error("Server error"), { status: 500 });
        return "fallback-success";
      },
      ctx: mockCtx,
      modelId: "test-model",
    });

    expect(fallbackCalled).toBe(true);
    expect(lastModelOverride).toBe("fallback-model");
    expect(result).toBe("fallback-success");
  });
});
