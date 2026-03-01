# Token-Based Compaction & Secret Redaction

**Date:** 2026-03-01
**Status:** Approved
**Location:** Both features in `@kitn/core`

## Overview

Two additions to core:

1. **Token-based compaction** — replace message-count compaction with token-count-based triggering, plus overflow recovery when conversations exceed context window limits.
2. **Secret redaction** — a wrapper around lifecycle hooks that scrubs sensitive data from event payloads before they reach any handler (OTEL, logging, ACP, dashboards).

---

## 1. Token-Based Compaction

### Problem

Current compaction triggers at a fixed message count (default: 20). This is a poor proxy for actual context window usage — 20 short messages use far fewer tokens than 20 long tool-result messages. There's also no recovery when a conversation already exceeds the model's context window.

### Design

#### Config

```ts
interface CompactionConfig {
  /** Token limit that triggers compaction (default: 80_000) */
  tokenLimit?: number;
  /** Estimated tokens to preserve from recent messages (default: 8_000) */
  preserveTokens?: number;
  /** Custom system prompt for summarization */
  prompt?: string;
  /** Model to use for compaction */
  model?: string;
  /** Enable/disable (default: true when config provided) */
  enabled?: boolean;
}
```

Replaces `threshold` (message count) with `tokenLimit` and `preserveRecent` (message count) with `preserveTokens` (token budget).

#### Token Estimation

Simple heuristic: `Math.ceil(text.length / 4)`. No external dependencies, no model access required. Isolated in `utils/token-estimate.ts` for testability.

#### Compaction Logic

`needsCompaction` checks total conversation token estimate against `tokenLimit`. When triggered:

1. Walk messages from newest to oldest, accumulating token estimates until `preserveTokens` is reached — those are the preserved messages.
2. Everything older gets summarized by the compaction LLM.
3. Conversation is rebuilt: summary message + preserved messages.

#### Overflow Recovery

Two-layer graceful degradation:

**Pre-request check:** Before calling `streamText`/`generateText`, estimate total tokens (system prompt + conversation + tool definitions). If over the model's limit, force-compact. If still over, progressively drop oldest preserved messages.

**Post-compaction validation:** After the compaction LLM produces a summary, re-estimate the total. If summary + preserved messages still exceeds the limit, re-compact with fewer preserved messages or instruct the LLM to produce a shorter summary.

**Fallback cascade:**

```
Over limit → Compact → Still over? → Reduce preserved messages → Still over? → Truncate summary to fit
```

The final truncation is a hard safety net that guarantees requests never fail due to context overflow.

### Files

| File | Change |
|------|--------|
| `utils/token-estimate.ts` | New — `estimateTokens(text: string): number` |
| `utils/compaction.ts` | Replace message-count logic with token-based, add overflow cascade |
| `utils/conversation-helpers.ts` | Update `loadConversationWithCompaction` for token checks |
| `utils/constants.ts` | New defaults: `COMPACTION_TOKEN_LIMIT`, `COMPACTION_PRESERVE_TOKENS` |
| `types.ts` | Update `CompactionConfig` fields |

---

## 2. Secret Redaction for Lifecycle Hooks

### Problem

Lifecycle hooks emit events containing agent inputs, outputs, and tool results. Any of these can contain secrets (API keys, tokens, passwords). If someone wires hooks to OTEL, a logger, or any external system, secrets leak.

### Design

#### Config

```ts
interface RedactionConfig {
  /** Built-in patterns to enable (default: all) */
  builtins?: ('apiKeys' | 'tokens' | 'passwords' | 'creditCards' | 'ssn' | 'emails')[];
  /** Custom regex patterns to redact */
  patterns?: { name: string; regex: RegExp; replacement?: string }[];
  /** Fields to skip redaction on (e.g. "agentName", "timestamp") */
  skipFields?: string[];
}
```

Added to `CoreConfig`:

```ts
interface CoreConfig {
  // ... existing fields
  /** Secret redaction for lifecycle hook events */
  redaction?: RedactionConfig;
}
```

#### How It Works

`createRedactedHooks(inner, config)` wraps an existing `LifecycleHookEmitter`:

- Intercepts `emit` — before any handler fires, deep-walks the event payload
- String values are tested against all active redaction patterns
- Matches replaced with `[REDACTED:<pattern-name>]`
- Non-string fields (numbers, booleans, timestamps) pass through untouched
- `skipFields` whitelists known-safe fields to skip processing

#### Built-in Patterns

All enabled by default when `redaction` config is provided:

| Pattern | Matches |
|---------|---------|
| `apiKeys` | `sk-`, `pk-`, `key-` prefixed strings, `Bearer` tokens |
| `tokens` | JWTs (`eyJ...`), hex tokens (32+ chars) |
| `passwords` | Values adjacent to `password`, `secret`, `credential` field names |
| `creditCards` | 13-19 digit sequences with Luhn check |
| `ssn` | `XXX-XX-XXXX` pattern |
| `emails` | Standard email regex |

#### Key Constraint

Redaction is **observability-only**. It never touches agent runtime data — only the copies that flow through the lifecycle hook emitter. An agent that needs an API key to call a tool still gets the full unredacted value.

#### Zero Overhead

No `redaction` config = no wrapping. The hook emitter works exactly as before.

### Files

| File | Change |
|------|--------|
| `hooks/redaction.ts` | New — `createRedactedHooks`, built-in patterns, deep-walk redactor |
| `types.ts` | Add `RedactionConfig` to `CoreConfig` |
| `index.ts` | Export redaction types and `createRedactedHooks` |

---

## Testing

| Test file | Coverage |
|-----------|----------|
| `test/compaction.test.ts` | Token-based triggering, overflow cascade, truncation fallback, edge cases (empty conversation, single message) |
| `test/redaction.test.ts` | Each built-in pattern, custom patterns, `skipFields`, deep-walk on nested objects, zero-overhead when unconfigured |
| `test/token-estimate.test.ts` | Heuristic accuracy, empty strings, unicode |

## Not In Scope

- Model-specific tokenizers (using heuristic instead)
- ACP transport (doesn't exist in kitn yet)
- Changes to adapters, CLI, or registry components
- Changes to the `compact-agent` registry component (separate concern — on-demand summarization agent)
