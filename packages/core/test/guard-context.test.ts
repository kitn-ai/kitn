import { describe, test, expect } from "bun:test";
import type { GuardResult, GuardContext } from "../src/registry/agent-registry.js";

describe("GuardContext type", () => {
  test("guard with context parameter works", async () => {
    const guard = async (
      query: string,
      agent: string,
      context?: GuardContext,
    ): Promise<GuardResult> => {
      if (context?.hasHistory) return { allowed: true };
      if (query.includes("blocked")) return { allowed: false, reason: "blocked" };
      return { allowed: true };
    };

    // First message — guard runs normally
    expect((await guard("blocked content", "test")).allowed).toBe(false);

    // Follow-up — guard skips
    expect((await guard("blocked content", "test", { hasHistory: true })).allowed).toBe(true);
  });

  test("guard without context still works (backward compat)", async () => {
    const guard = async (query: string, agent: string): Promise<GuardResult> => {
      return { allowed: true };
    };

    expect((await guard("anything", "test")).allowed).toBe(true);
  });

  test("context includes optional fields", async () => {
    const guard = async (
      query: string,
      agent: string,
      context?: GuardContext,
    ): Promise<GuardResult> => {
      if (context?.messageCount && context.messageCount > 5) {
        return { allowed: true };
      }
      return { allowed: false, reason: "need more history" };
    };

    expect((await guard("test", "agent", { hasHistory: true, messageCount: 10, conversationId: "conv-123" })).allowed).toBe(true);
    expect((await guard("test", "agent", { hasHistory: true, messageCount: 2 })).allowed).toBe(false);
  });
});
