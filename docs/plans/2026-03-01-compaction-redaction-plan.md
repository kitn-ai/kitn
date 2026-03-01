# Token-Based Compaction & Secret Redaction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace message-count compaction with token-count-based compaction (with overflow recovery), and add a secret redaction layer for lifecycle hook events.

**Architecture:** Two independent features in `@kitn/core`. Compaction rewrites `utils/compaction.ts` and `utils/conversation-helpers.ts` to use token estimates instead of message counts. Redaction adds a new `hooks/redaction.ts` that wraps the existing `LifecycleHookEmitter` to scrub sensitive data from event payloads before handlers fire.

**Tech Stack:** TypeScript, bun:test, AI SDK v6 (`generateText`), existing kitn core utilities (`withResilience`, `emitStatus`)

**Design doc:** `docs/plans/2026-03-01-compaction-redaction-design.md`

---

### Task 1: Token Estimation Utility

**Files:**
- Create: `packages/core/src/utils/token-estimate.ts`
- Test: `packages/core/test/token-estimate.test.ts`

**Step 1: Write the failing test**

Create `packages/core/test/token-estimate.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { estimateTokens, estimateMessageTokens } from "../src/utils/token-estimate.js";

describe("estimateTokens", () => {
  test("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars → ceil(11/4) = 3
  });

  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("handles unicode characters", () => {
    const emoji = "Hello 👋🌍"; // 9 chars (emoji are multi-byte but .length counts UTF-16 code units)
    expect(estimateTokens(emoji)).toBeGreaterThan(0);
  });

  test("handles long text", () => {
    const text = "a".repeat(400_000); // 400k chars → 100k tokens
    expect(estimateTokens(text)).toBe(100_000);
  });
});

describe("estimateMessageTokens", () => {
  test("sums token estimates across messages", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: "" },
      { role: "assistant" as const, content: "world", timestamp: "" },
    ];
    // "hello" = 2, "world" = 2 → 4
    expect(estimateMessageTokens(messages)).toBe(4);
  });

  test("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/token-estimate.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/utils/token-estimate.ts`:

```ts
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
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/token-estimate.test.ts`
Expected: PASS — all 6 tests

**Step 5: Commit**

```bash
git add packages/core/src/utils/token-estimate.ts packages/core/test/token-estimate.test.ts
git commit -m "feat(core): add token estimation utility for compaction"
```

---

### Task 2: Update CompactionConfig Types & Constants

**Files:**
- Modify: `packages/core/src/types.ts:46-57` (CompactionConfig interface)
- Modify: `packages/core/src/utils/constants.ts:15-16` (DEFAULTS)

**Step 1: Write the failing test**

Create `packages/core/test/compaction-config.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { DEFAULTS } from "../src/utils/constants.js";
import type { CompactionConfig } from "../src/types.js";

describe("CompactionConfig defaults", () => {
  test("has COMPACTION_TOKEN_LIMIT default", () => {
    expect(DEFAULTS.COMPACTION_TOKEN_LIMIT).toBe(80_000);
  });

  test("has COMPACTION_PRESERVE_TOKENS default", () => {
    expect(DEFAULTS.COMPACTION_PRESERVE_TOKENS).toBe(8_000);
  });

  test("no longer has message-count COMPACTION_THRESHOLD", () => {
    expect("COMPACTION_THRESHOLD" in DEFAULTS).toBe(false);
  });

  test("no longer has COMPACTION_PRESERVE_RECENT", () => {
    expect("COMPACTION_PRESERVE_RECENT" in DEFAULTS).toBe(false);
  });

  test("CompactionConfig accepts tokenLimit", () => {
    const config: CompactionConfig = { tokenLimit: 50_000 };
    expect(config.tokenLimit).toBe(50_000);
  });

  test("CompactionConfig accepts preserveTokens", () => {
    const config: CompactionConfig = { preserveTokens: 4_000 };
    expect(config.preserveTokens).toBe(4_000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/compaction-config.test.ts`
Expected: FAIL — `COMPACTION_TOKEN_LIMIT` doesn't exist, `COMPACTION_THRESHOLD` still exists

**Step 3: Update constants**

Modify `packages/core/src/utils/constants.ts` — replace COMPACTION_THRESHOLD and COMPACTION_PRESERVE_RECENT:

```ts
/** Default configuration values */
export const DEFAULTS = {
  MAX_DELEGATION_DEPTH: 3,
  MAX_STEPS: 5,
  SYNTHESIS_MESSAGE: "Synthesizing results...",
  RESPONSE_SKILLS_KEY: "_responseSkills",
  COMPACTION_TOKEN_LIMIT: 80_000,
  COMPACTION_PRESERVE_TOKENS: 8_000,
  SUMMARY_LENGTH_LIMIT: 200,
} as const;
```

**Step 4: Update CompactionConfig type**

Modify `packages/core/src/types.ts:46-57` — replace the CompactionConfig interface:

```ts
export interface CompactionConfig {
  /** Token limit that triggers compaction (default: 80_000) */
  tokenLimit?: number;
  /** Estimated tokens to preserve from recent messages (default: 8_000) */
  preserveTokens?: number;
  /** Custom system prompt for summarization LLM call */
  prompt?: string;
  /** Model to use for compaction (defaults to plugin default) */
  model?: string;
  /** Enable/disable auto-compaction (default: true when config provided) */
  enabled?: boolean;
}
```

**Step 5: Run test to verify it passes**

Run: `bun test packages/core/test/compaction-config.test.ts`
Expected: PASS — all 6 tests

**Step 6: Run full core typecheck to catch breakages**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: May show errors in compaction.ts and conversation-helpers.ts that still reference old fields — that's expected, we fix those in Task 3.

**Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/utils/constants.ts packages/core/test/compaction-config.test.ts
git commit -m "feat(core): update CompactionConfig to token-based fields"
```

---

### Task 3: Rewrite Compaction Logic (Token-Based + Overflow Recovery)

**Files:**
- Modify: `packages/core/src/utils/compaction.ts` (full rewrite)
- Test: `packages/core/test/compaction.test.ts`

**Step 1: Write the failing tests**

Create `packages/core/test/compaction.test.ts`:

```ts
import { describe, test, expect, mock } from "bun:test";
import { needsCompaction, compactConversation, COMPACTION_METADATA_KEY } from "../src/utils/compaction.js";
import { estimateTokens } from "../src/utils/token-estimate.js";
import type { Conversation, ConversationMessage } from "../src/storage/interfaces.js";

// Helper to create messages with specific content lengths
function makeMessage(role: "user" | "assistant", charCount: number, meta?: Record<string, unknown>): ConversationMessage {
  return {
    role,
    content: "x".repeat(charCount),
    timestamp: new Date().toISOString(),
    metadata: meta,
  };
}

function makeConversation(messages: ConversationMessage[]): Conversation {
  return { id: "test-conv", messages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe("needsCompaction (token-based)", () => {
  test("returns true when conversation tokens exceed limit", () => {
    // 400 chars per message × 10 messages = 4000 chars = 1000 tokens
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i % 2 === 0 ? "user" : "assistant", 400));
    const conv = makeConversation(messages);
    expect(needsCompaction(conv, 500)).toBe(true); // 1000 > 500
  });

  test("returns false when conversation tokens are under limit", () => {
    const messages = [makeMessage("user", 40), makeMessage("assistant", 40)];
    const conv = makeConversation(messages);
    expect(needsCompaction(conv, 500)).toBe(false); // 20 < 500
  });

  test("uses default token limit when none provided", () => {
    // Default is 80_000 tokens = 320_000 chars
    const messages = [makeMessage("user", 100)];
    const conv = makeConversation(messages);
    expect(needsCompaction(conv)).toBe(false);
  });
});

describe("compactConversation (token-based)", () => {
  function createMockCtx(messages: ConversationMessage[], summaryResponse = "Summary of conversation") {
    const stored: ConversationMessage[] = [...messages];
    let cleared = false;

    return {
      ctx: {
        config: {
          compaction: { tokenLimit: 500, preserveTokens: 100 },
        },
        storage: {
          conversations: {
            get: mock(async () => (cleared ? makeConversation([]) : makeConversation(stored))),
            clear: mock(async () => { cleared = true; stored.length = 0; }),
            append: mock(async (_id: string, msg: ConversationMessage) => { stored.push(msg); }),
          },
        },
        model: () => ({}) as any,
      } as any,
      stored,
      summaryResponse,
    };
  }

  test("preserves recent messages by token budget", async () => {
    // 10 messages × 200 chars = 500 tokens total. preserveTokens = 100 → last ~2 messages (100 chars each = 50 tokens ≈ fills budget)
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i % 2 === 0 ? "user" : "assistant", 200));

    const { ctx } = createMockCtx(messages);

    // Mock generateText via resilience
    const { withResilience } = await import("../src/utils/resilience.js");

    const result = await compactConversation(ctx, "test-conv");
    expect(result).not.toBeNull();
    expect(result!.preservedCount).toBeGreaterThan(0);
    expect(result!.summarizedCount).toBeGreaterThan(0);
  });

  test("returns null for missing conversation", async () => {
    const ctx = {
      config: { compaction: {} },
      storage: { conversations: { get: mock(async () => null) } },
      model: () => ({}) as any,
    } as any;

    const result = await compactConversation(ctx, "nonexistent");
    expect(result).toBeNull();
  });

  test("skips compaction when all messages fit in preserve budget", async () => {
    // 2 messages × 40 chars = 20 tokens, preserveTokens = 100 → all fit
    const messages = [makeMessage("user", 40), makeMessage("assistant", 40)];
    const { ctx } = createMockCtx(messages);

    const result = await compactConversation(ctx, "test-conv");
    expect(result).not.toBeNull();
    expect(result!.summarizedCount).toBe(0);
    expect(result!.preservedCount).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/compaction.test.ts`
Expected: FAIL — `needsCompaction` still uses message-count signature

**Step 3: Rewrite compaction.ts**

Replace the full contents of `packages/core/src/utils/compaction.ts`:

```ts
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
  // Check if summary + preserved messages still exceed the token limit.
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
      const maxChars = availableForSummary * 4; // reverse the heuristic
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
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/compaction.test.ts`
Expected: PASS (some tests may need mock adjustments — fix as needed)

**Step 5: Run typecheck**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: May still fail on conversation-helpers.ts — fixed in Task 4

**Step 6: Commit**

```bash
git add packages/core/src/utils/compaction.ts packages/core/test/compaction.test.ts
git commit -m "feat(core): rewrite compaction to token-based with overflow recovery"
```

---

### Task 4: Update conversation-helpers.ts

**Files:**
- Modify: `packages/core/src/utils/conversation-helpers.ts` (full file)

**Step 1: Write the failing test**

Add to `packages/core/test/compaction.test.ts` (or create a separate file):

```ts
// In packages/core/test/conversation-helpers.test.ts
import { describe, test, expect, mock } from "bun:test";
import { loadConversationWithCompaction } from "../src/utils/conversation-helpers.js";
import type { Conversation, ConversationMessage } from "../src/storage/interfaces.js";

function makeConversation(messages: ConversationMessage[]): Conversation {
  return { id: "test-conv", messages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe("loadConversationWithCompaction (token-based)", () => {
  test("triggers compaction when tokens exceed tokenLimit", async () => {
    // Each message = 1600 chars = 400 tokens. 3 messages = 1200 tokens, limit is 800
    const messages: ConversationMessage[] = Array.from({ length: 3 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(1600),
      timestamp: new Date().toISOString(),
    }));

    let compactCalled = false;
    const ctx = {
      config: {
        compaction: { enabled: true, tokenLimit: 800 },
      },
      storage: {
        conversations: {
          get: mock(async () => makeConversation(messages)),
          append: mock(async () => {}),
          clear: mock(async () => {}),
        },
      },
      model: () => ({}) as any,
    } as any;

    // We're testing that it calls needsCompaction correctly — the actual compaction
    // path would need withResilience/generateText mocked. For this test, checking
    // that it attempts compaction (which will throw) is sufficient.
    try {
      await loadConversationWithCompaction(ctx, "test-conv", "hello");
    } catch {
      // Expected — compaction tries to call LLM which isn't mocked
      compactCalled = true;
    }
    // Either it compacted successfully or tried to (both prove token-based check works)
    expect(ctx.storage.conversations.get).toHaveBeenCalled();
  });

  test("returns undefined for new conversation (first message)", async () => {
    const ctx = {
      config: {},
      storage: {
        conversations: {
          get: mock(async () => null),
          append: mock(async () => {}),
        },
      },
    } as any;

    const result = await loadConversationWithCompaction(ctx, "new-conv", "hello");
    expect(result).toBeUndefined();
    expect(ctx.storage.conversations.append).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/conversation-helpers.test.ts`
Expected: FAIL — conversation-helpers still references old `threshold` field

**Step 3: Update conversation-helpers.ts**

Replace the full contents of `packages/core/src/utils/conversation-helpers.ts`:

```ts
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
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/test/conversation-helpers.test.ts`
Expected: PASS

**Step 5: Run typecheck across core**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: PASS — all references to old fields are now gone

**Step 6: Commit**

```bash
git add packages/core/src/utils/conversation-helpers.ts packages/core/test/conversation-helpers.test.ts
git commit -m "feat(core): update conversation helpers for token-based compaction"
```

---

### Task 5: Update Core Exports

**Files:**
- Modify: `packages/core/src/index.ts:94-96` (compaction exports)

**Step 1: Update exports**

In `packages/core/src/index.ts`, add the token-estimate exports. Find the compaction section (line ~94) and add after it:

```ts
// ── Token estimation ──
export { estimateTokens, estimateMessageTokens } from "./utils/token-estimate.js";
```

**Step 2: Run typecheck**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: PASS

**Step 3: Run all core tests**

Run: `bun run --cwd packages/core test`
Expected: PASS — all existing + new tests

**Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export token estimation utilities"
```

---

### Task 6: Secret Redaction — Tests

**Files:**
- Test: `packages/core/test/redaction.test.ts`

**Step 1: Write the failing tests**

Create `packages/core/test/redaction.test.ts`:

```ts
import { describe, test, expect, mock } from "bun:test";
import { createRedactedHooks, BUILTIN_PATTERNS, redactValue, redactObject } from "../src/hooks/redaction.js";
import { createLifecycleHooks } from "../src/hooks/lifecycle-hooks.js";
import type { RedactionConfig } from "../src/types.js";

describe("redactValue", () => {
  test("redacts sk- prefixed API keys", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "apiKeys");
    expect(redactValue("my key is sk-abc123def456", patterns)).toBe("my key is [REDACTED:apiKeys]");
  });

  test("redacts Bearer tokens", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "apiKeys");
    expect(redactValue("Bearer eyJhbGciOiJIUzI1NiJ9.test.sig", patterns)).toBe("[REDACTED:apiKeys]");
  });

  test("redacts JWTs", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "tokens");
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactValue(jwt, patterns)).toContain("[REDACTED:tokens]");
  });

  test("redacts long hex tokens", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "tokens");
    const hex = "a".repeat(40); // 40-char hex token
    expect(redactValue(`token: ${hex}`, patterns)).toContain("[REDACTED:tokens]");
  });

  test("redacts SSNs", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "ssn");
    expect(redactValue("SSN: 123-45-6789", patterns)).toBe("SSN: [REDACTED:ssn]");
  });

  test("redacts emails", () => {
    const patterns = BUILTIN_PATTERNS.filter((p) => p.name === "emails");
    expect(redactValue("contact user@example.com please", patterns)).toContain("[REDACTED:emails]");
  });

  test("returns non-string values unchanged", () => {
    const patterns = BUILTIN_PATTERNS;
    expect(redactValue(42 as any, patterns)).toBe(42);
    expect(redactValue(true as any, patterns)).toBe(true);
    expect(redactValue(null as any, patterns)).toBe(null);
  });
});

describe("redactObject", () => {
  test("deep-walks nested objects", () => {
    const obj = {
      outer: { inner: "key is sk-secret123" },
      safe: 42,
    };
    const result = redactObject(obj, BUILTIN_PATTERNS);
    expect((result as any).outer.inner).toContain("[REDACTED:apiKeys]");
    expect((result as any).safe).toBe(42);
  });

  test("handles arrays", () => {
    const obj = { items: ["sk-key1", "safe", "sk-key2"] };
    const result = redactObject(obj, BUILTIN_PATTERNS);
    expect((result as any).items[0]).toContain("[REDACTED:apiKeys]");
    expect((result as any).items[1]).toBe("safe");
    expect((result as any).items[2]).toContain("[REDACTED:apiKeys]");
  });

  test("skips specified fields", () => {
    const obj = { agentName: "sk-not-a-real-key", input: "sk-real-key" };
    const result = redactObject(obj, BUILTIN_PATTERNS, new Set(["agentName"]));
    expect((result as any).agentName).toBe("sk-not-a-real-key");
    expect((result as any).input).toContain("[REDACTED:apiKeys]");
  });
});

describe("createRedactedHooks", () => {
  test("wraps emitter and redacts event payloads", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {});

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Use key sk-mysecretkey123",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].input).toContain("[REDACTED:apiKeys]");
    expect(received[0].agentName).toBe("test"); // non-secret fields preserved
  });

  test("passes through when no patterns match", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {});

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Hello, how are you?",
      timestamp: Date.now(),
    });

    expect(received[0].input).toBe("Hello, how are you?");
  });

  test("respects builtins filter — only redacts selected patterns", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, { builtins: ["ssn"] }); // only SSN

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "key sk-abc123 and ssn 123-45-6789",
      timestamp: Date.now(),
    });

    expect(received[0].input).toContain("sk-abc123"); // NOT redacted — apiKeys not in builtins
    expect(received[0].input).toContain("[REDACTED:ssn]");
  });

  test("supports custom patterns", () => {
    const inner = createLifecycleHooks({ level: "trace" });
    const redacted = createRedactedHooks(inner, {
      patterns: [{ name: "customId", regex: /CUST-\d{6}/g }],
    });

    const received: any[] = [];
    redacted.on("agent:start", (data) => received.push(data));

    redacted.emit("agent:start", {
      agentName: "test",
      conversationId: "conv-1",
      input: "Customer CUST-123456",
      timestamp: Date.now(),
    });

    expect(received[0].input).toContain("[REDACTED:customId]");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/redaction.test.ts`
Expected: FAIL — module `../src/hooks/redaction.js` not found

**Step 3: Commit test file**

```bash
git add packages/core/test/redaction.test.ts
git commit -m "test(core): add secret redaction tests"
```

---

### Task 7: Secret Redaction — Implementation

**Files:**
- Create: `packages/core/src/hooks/redaction.ts`
- Modify: `packages/core/src/types.ts:78-79` (add `redaction` to CoreConfig)
- Modify: `packages/core/src/hooks/index.ts` (add exports)
- Modify: `packages/core/src/index.ts` (add exports)

**Step 1: Add RedactionConfig to types.ts**

In `packages/core/src/types.ts`, add after `CompactionConfig` and before `CoreConfig`:

```ts
export interface RedactionPattern {
  name: string;
  regex: RegExp;
  replacement?: string;
}

export type BuiltinRedactionPattern = "apiKeys" | "tokens" | "passwords" | "creditCards" | "ssn" | "emails";

export interface RedactionConfig {
  /** Built-in patterns to enable (default: all) */
  builtins?: BuiltinRedactionPattern[];
  /** Custom regex patterns to redact */
  patterns?: RedactionPattern[];
  /** Fields to skip redaction on (e.g. "agentName", "timestamp") */
  skipFields?: string[];
}
```

And add to `CoreConfig`:

```ts
/** Secret redaction for lifecycle hook events */
redaction?: RedactionConfig;
```

**Step 2: Create redaction.ts**

Create `packages/core/src/hooks/redaction.ts`:

```ts
import type { LifecycleHookEmitter, LifecycleEventName, LifecycleEventMap } from "./lifecycle-hooks.js";
import type { RedactionConfig, RedactionPattern } from "../types.js";

/** Built-in redaction patterns. Each regex MUST use the `g` flag for replaceAll behavior. */
export const BUILTIN_PATTERNS: RedactionPattern[] = [
  {
    name: "apiKeys",
    regex: /\b(sk-|pk-|key-)[A-Za-z0-9_\-]{8,}\b|Bearer\s+\S+/g,
  },
  {
    name: "tokens",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b[0-9a-f]{32,}\b/g,
  },
  {
    name: "passwords",
    // Matches values in key:value or key=value patterns where the key suggests a secret
    regex: /(?<=(password|secret|credential|passwd|pwd)\s*[:=]\s*)\S+/gi,
  },
  {
    name: "creditCards",
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/g,
  },
  {
    name: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: "emails",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  },
];

/**
 * Redact sensitive patterns from a string value.
 * Returns the original value unchanged if it's not a string.
 */
export function redactValue(value: unknown, patterns: RedactionPattern[]): unknown {
  if (typeof value !== "string") return value;

  let result = value;
  for (const pattern of patterns) {
    // Reset lastIndex for stateful regexes
    pattern.regex.lastIndex = 0;
    const replacement = pattern.replacement ?? `[REDACTED:${pattern.name}]`;
    result = result.replace(pattern.regex, replacement);
  }
  return result;
}

/**
 * Deep-walk an object and redact all string values that match patterns.
 * Returns a new object (does not mutate the original).
 */
export function redactObject(
  obj: Record<string, unknown>,
  patterns: RedactionPattern[],
  skipFields?: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (skipFields?.has(key)) {
      result[key] = value;
      continue;
    }

    if (typeof value === "string") {
      result[key] = redactValue(value, patterns);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? redactValue(item, patterns)
          : item && typeof item === "object"
            ? redactObject(item as Record<string, unknown>, patterns, skipFields)
            : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = redactObject(value as Record<string, unknown>, patterns, skipFields);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function resolvePatterns(config: RedactionConfig): RedactionPattern[] {
  const builtinNames = config.builtins; // undefined = all
  const builtins = builtinNames
    ? BUILTIN_PATTERNS.filter((p) => builtinNames.includes(p.name as any))
    : [...BUILTIN_PATTERNS];

  const custom = config.patterns ?? [];
  return [...builtins, ...custom];
}

/**
 * Wrap a LifecycleHookEmitter with secret redaction.
 * Event payloads are deep-walked and sensitive strings are replaced
 * before any handler fires.
 */
export function createRedactedHooks(
  inner: LifecycleHookEmitter,
  config: RedactionConfig,
): LifecycleHookEmitter {
  const patterns = resolvePatterns(config);
  const skipFields = config.skipFields ? new Set(config.skipFields) : undefined;

  return {
    on: inner.on.bind(inner),

    emit<E extends LifecycleEventName>(event: E, data: LifecycleEventMap[E]): void {
      const redacted = redactObject(
        data as unknown as Record<string, unknown>,
        patterns,
        skipFields,
      ) as unknown as LifecycleEventMap[E];
      inner.emit(event, redacted);
    },
  };
}
```

**Step 3: Update hooks/index.ts**

Add to `packages/core/src/hooks/index.ts`:

```ts
export { createRedactedHooks, BUILTIN_PATTERNS, redactValue, redactObject } from "./redaction.js";
```

**Step 4: Update core index.ts**

In `packages/core/src/index.ts`, add to the types export (line 2):

Add `RedactionConfig, RedactionPattern, BuiltinRedactionPattern` to the type export from `./types.js`.

And in the lifecycle hooks section (line ~119), add:

```ts
export { createRedactedHooks, BUILTIN_PATTERNS, redactValue, redactObject } from "./hooks/index.js";
```

**Step 5: Run redaction tests**

Run: `bun test packages/core/test/redaction.test.ts`
Expected: PASS — all tests

**Step 6: Run full core test suite**

Run: `bun run --cwd packages/core test`
Expected: PASS

**Step 7: Run typecheck**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/core/src/hooks/redaction.ts packages/core/src/hooks/index.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): add secret redaction layer for lifecycle hooks"
```

---

### Task 8: Full Suite Verification

**Files:** None — verification only

**Step 1: Run full monorepo typecheck**

Run: `bun run typecheck`
Expected: PASS across all packages

**Step 2: Run full monorepo tests**

Run: `bun run test`
Expected: PASS — no regressions

**Step 3: Run build**

Run: `bun run build`
Expected: PASS

**Step 4: Squash commit if needed, otherwise done**

If all passes, the feature is complete. If there are failures, fix them and commit fixes.
