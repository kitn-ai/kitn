# Chat REPL & Framework Improvements Design

**Date:** 2026-03-01
**Status:** Approved

## Context

The `kitn chat` command was migrated from `@clack/prompts` to a React Ink REPL. The REPL works but exposed two chat service issues: (1) follow-up messages rejected by the keyword guard, (2) models describing plans in prose instead of calling `createPlan`. Additionally, the chat service duplicates framework logic by using a custom `/api/chat` endpoint instead of the native agent execution pipeline.

This design addresses both the immediate UX issues and improves the kitn framework for all users.

## Goals

1. **Improve chat UX** — multi-turn REPL that works naturally, auto-compacts after tasks, enforces tool usage
2. **Improve the framework** — guard context parameter, better compaction defaults, reference implementation of native agent flow

## Non-Goals

- Multi-turn plan refinement (post-v1)
- Streaming responses in the REPL (future)
- Persistent server-side conversation storage (stay ephemeral)

---

## Change 1: Migrate Chat Service to Native Agent Flow

### Problem

The `/api/chat` endpoint in `packages/chat-service/src/index.ts` manually calls `generateText()`, builds the system prompt, and handles tool results — duplicating what the framework's agent execution pipeline already provides.

### Solution

Register the `assistant` agent with the framework plugin and have the CLI invoke it via the standard `POST /agents/assistant` pipeline.

### What the framework gives us for free

- **Auto-compaction** via `loadConversationWithCompaction()`
- **Memory injection** via built-in `_memory` tool + context injection into system prompt
- **Conversation persistence** via `ConversationStore` (in-memory)
- **Lifecycle hooks** (`agent:start`, `agent:end`, etc.)
- **Resilience** (retry with backoff on transient errors)
- **Tool loop control** via `stopWhen: stepCountIs(N)`

### Chat service changes

- Keep `/api/chat` as a **thin adapter** that receives the CLI's request format (messages + metadata), creates/updates an in-memory conversation, and delegates to the internal agent execution
- Remove `/api/chat/compact` endpoint — compaction is now automatic
- Configure plugin with compaction settings:

```ts
const plugin = createAIPlugin({
  model: (id) => getModel(id ?? DEFAULT_MODEL),
  storage: createMemoryStorage(),  // ephemeral, per-process
  compaction: {
    threshold: 10,       // compact after 10 messages (tight for chat)
    preserveRecent: 4,   // keep last 4 messages verbatim
  },
});
```

- The system prompt is still built dynamically from metadata (passed per-request), so `defaultSystem` in the agent registration is a base that gets augmented with registry context

### CLI changes

- `use-chat` hook manages a `conversationId` instead of sending full message history
- Remove client-side compaction logic from `chat-engine.ts` (framework handles it)
- `callChatService()` now sends `{ message, conversationId, metadata }` instead of `{ messages, metadata }`

### Key files

- `packages/chat-service/src/index.ts` — rewrite `/api/chat` as thin adapter
- `packages/chat-service/src/agents/assistant.ts` — register with full tool set
- `packages/cli/src/commands/chat-engine.ts` — simplify `callChatService()`, remove `compactConversation()`
- `packages/cli/src/commands/chat/hooks/use-chat.ts` — manage `conversationId`

---

## Change 2: Skip Guard on Follow-ups

### Problem

`assistantGuard()` runs on every message. Follow-ups like "do it", "that sounds good", and "go ahead" are rejected because they lack component keywords.

### Solution

If the conversation already has history (prior assistant messages), skip the guard entirely — context is established.

### Implementation

Extend the guard to accept conversation context:

```ts
export async function assistantGuard(
  query: string,
  _agentName?: string,
  context?: { hasHistory: boolean },
): Promise<GuardResult> {
  if (context?.hasHistory) return { allowed: true };
  // ... existing keyword + LLM guard logic
}
```

The thin adapter in `/api/chat` passes `hasHistory: messages.length > 1` to the guard.

### Framework improvement

The framework's guard interface currently receives `(query, agentName)`. Extend it to optionally receive a third `context` parameter with conversation metadata. Non-breaking — existing guards ignore it.

### Key files

- `packages/chat-service/src/agents/assistant.ts` — update `assistantGuard()` signature
- `packages/core/src/agents/` — extend guard interface type (optional third param)

---

## Change 3: Auto-Compact After Plan Execution

### Problem

After a plan executes (potentially many tool call + result messages), the conversation history is bloated with verbose step results, increasing token costs for subsequent turns.

### Solution

With native agent flow, the framework's built-in compaction handles this automatically. Plan execution generates many messages (assistant tool calls + tool results for each step), which naturally exceeds the `compaction.threshold`. On the next agent invocation, `loadConversationWithCompaction()` auto-summarizes.

### Configuration

Set a tight threshold in the chat service plugin config:

```ts
compaction: {
  threshold: 10,       // plan execution easily generates 10+ messages
  preserveRecent: 4,   // keep the most recent context
}
```

### No additional code needed

The framework handles this entirely. The CLI just keeps sending messages — compaction happens transparently server-side on each agent invocation.

---

## Change 4: Stronger Tool Enforcement + Client-Side Retry

### Problem

Models sometimes describe plans in prose instead of calling `createPlan`, even though the system prompt says "ALWAYS call createPlan."

### Solution A: Stronger system prompt

Add concrete negative examples and reinforcement to `packages/chat-service/src/prompts/system.ts`:

```
CRITICAL: You MUST call the createPlan tool for ANY proposed action. NEVER describe a plan in text.

WRONG (never do this):
"Here's what I'll do:
1. Add the weather-tool
2. Create a custom agent..."

RIGHT (always do this):
Call createPlan with structured steps.

If you find yourself writing numbered steps in prose, STOP and call createPlan instead.
```

### Solution B: Client-side retry in the CLI

In the `use-chat` hook, after receiving a text-only response (no tool calls), check if the text looks like a plan (contains numbered steps + action verbs + component names). If detected, automatically send a follow-up:

```
You described a plan in text instead of calling createPlan. Please call the createPlan tool with the steps you just described.
```

One retry max. If the second response also has no tool calls, display it as-is.

### Detection heuristic

```ts
function looksLikePlan(text: string): boolean {
  const hasNumberedSteps = /\d+\.\s/.test(text);
  const hasActionVerbs = /\b(add|create|install|remove|link|scaffold|set up)\b/i.test(text);
  const hasComponentRefs = /\b(agent|tool|skill|storage|cron)\b/i.test(text);
  return hasNumberedSteps && hasActionVerbs && hasComponentRefs;
}
```

### Key files

- `packages/chat-service/src/prompts/system.ts` — strengthen tool enforcement section
- `packages/cli/src/commands/chat/hooks/use-chat.ts` — add retry logic
- `packages/cli/src/commands/chat-engine.ts` — add `looksLikePlan()` helper

---

## Change 5: Framework Guard Interface Enhancement

### Problem

The framework's guard type is `(query: string, agentName?: string) => Promise<GuardResult>`. Guards can't be conversation-aware.

### Solution

Extend the guard type to accept an optional third parameter with conversation context:

```ts
interface GuardContext {
  hasHistory: boolean;
  conversationId?: string;
  messageCount?: number;
}

type AgentGuard = (
  query: string,
  agentName?: string,
  context?: GuardContext,
) => Promise<GuardResult>;
```

The framework passes this context when invoking the guard during agent execution. Existing guards that only accept `(query, agentName)` continue to work — the third parameter is optional.

### Key files

- `packages/core/src/types.ts` or wherever `AgentGuard` is defined
- `packages/core/src/agents/run-agent.ts` — pass context when calling guard
- `packages/adapters/hono/src/routes/agents/` — extract conversation info for guard context

---

## Summary of Changes

| # | Change | Scope | Benefit |
|---|--------|-------|---------|
| 1 | Native agent flow | Chat service + CLI | Free compaction, memory, resilience, hooks |
| 2 | Skip guard on follow-ups | Chat service + Core | Multi-turn REPL works naturally |
| 3 | Auto-compact after plans | Config only | Lower token costs, clean context |
| 4 | Stronger prompt + retry | Chat service + CLI | Models use createPlan reliably |
| 5 | Guard context parameter | Core framework | All guards can be conversation-aware |

## File Impact

### Chat service (`packages/chat-service/`)
- `src/index.ts` — rewrite `/api/chat`, remove `/api/chat/compact`
- `src/agents/assistant.ts` — update guard, register with full tools
- `src/prompts/system.ts` — strengthen tool enforcement

### CLI (`packages/cli/`)
- `src/commands/chat-engine.ts` — simplify service call, add `looksLikePlan()`, remove compaction
- `src/commands/chat/hooks/use-chat.ts` — manage conversationId, add retry logic

### Core framework (`packages/core/`)
- Guard type definition — add optional `GuardContext` parameter
- Agent execution — pass context to guard

### No changes needed
- `chat-types.ts` — types stay the same
- Ink components — no UI changes needed
- Test files — update to match new signatures
