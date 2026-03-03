import { describe, test, expect } from "bun:test";
import { RateLimiter } from "../src/permissions/rate-limiter.js";

describe("RateLimiter", () => {
  test("allows calls within limit", () => {
    const rl = new RateLimiter({ maxPerMinute: 5 });
    for (let i = 0; i < 5; i++) {
      expect(rl.tryAcquire("bash")).toBe(true);
    }
  });

  test("blocks calls over limit", () => {
    const rl = new RateLimiter({ maxPerMinute: 3 });
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
  });

  test("separate limits per tool", () => {
    const rl = new RateLimiter({ maxPerMinute: 2 });
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
    expect(rl.tryAcquire("file-write")).toBe(true);
  });

  test("per-tool overrides", () => {
    const rl = new RateLimiter({ maxPerMinute: 10, toolLimits: { bash: 2 } });
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
    for (let i = 0; i < 10; i++) {
      expect(rl.tryAcquire("file-write")).toBe(true);
    }
  });

  test("resets after window expires", async () => {
    const rl = new RateLimiter({ maxPerMinute: 1, windowMs: 100 });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(rl.tryAcquire("bash")).toBe(true);
  });
});
