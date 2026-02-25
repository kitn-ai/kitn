# @kitnai/core Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the framework-agnostic engine from `@kitnai/server` into `@kitnai/core`, rename server to `@kitnai/hono`, and restructure into domain modules.

**Architecture:** Create `packages/core/` with domain-based directories (agents/, registry/, storage/, streaming/, events/, voice/, utils/, schemas/). Replace all Hono dependencies with a web-standard `AgentRequest` interface and `createSSEStream` utility. The `packages/hono/` package (renamed from server) becomes a thin adapter that converts Hono Context to AgentRequest and mounts routes.

**Tech Stack:** TypeScript, Vercel AI SDK (peer dep), Zod (peer dep), `ReadableStream` for SSE

**Design doc:** `docs/plans/2026-02-25-core-extraction-design.md`

---

## Task 1: Create `packages/core/` scaffold

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts` (empty for now)

**Step 1:** Create package.json

```json
{
  "name": "@kitnai/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc"
  },
  "peerDependencies": {
    "ai": "^6.0.91",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3",
    "ai": "^6.0.91",
    "zod": "^4.3.6"
  }
}
```

**Step 2:** Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

**Step 3:** Create empty `packages/core/src/index.ts` with a placeholder comment.

**Step 4:** Run `bun install` to register the workspace package.

**Step 5:** Verify `bun run --cwd packages/core build` succeeds.

**Step 6:** Commit: `"feat(core): scaffold @kitnai/core package"`

---

## Task 2: Create core types and SSE writer

These are the new abstractions that decouple core from Hono.

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/streaming/sse-writer.ts`

**Step 1:** Create `types.ts` with `AgentRequest`, `PluginContext`, and other core-only types.

The `AgentRequest` interface replaces Hono's `Context` in all handler signatures:

```ts
import type { LanguageModel } from "ai";
import type { AgentRegistry } from "./registry/agent-registry.js";
import type { ToolRegistry } from "./registry/tool-registry.js";
import type { StorageProvider } from "./storage/interfaces.js";
import type { VoiceManager } from "./voice/voice-manager.js";
import type { CardRegistry } from "./utils/card-registry.js";

/** Framework-agnostic request interface. Adapters (Hono, Express, etc.) convert their
 *  native request objects into this shape before calling core handlers. */
export interface AgentRequest {
  json<T = unknown>(): Promise<T>;
  query(key: string): string | undefined;
  param(key: string): string;
  header(key: string): string | undefined;
  /** The raw Web API Request (for access to .signal, etc.) */
  raw: Request;
}

export interface ResilienceConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  onFallback?: (context: FallbackContext) => string | null | Promise<string | null>;
}

export interface FallbackContext {
  agent?: string;
  currentModel: string;
  retryCount: number;
  error: Error;
}

export interface CompactionConfig {
  threshold?: number;
  preserveRecent?: number;
  prompt?: string;
  model?: string;
  enabled?: boolean;
}

export interface CoreConfig {
  getModel: (id?: string) => LanguageModel;
  storage?: StorageProvider;
  maxDelegationDepth?: number;
  defaultMaxSteps?: number;
  resilience?: ResilienceConfig;
  compaction?: CompactionConfig;
}

/** Internal context passed to all core handlers and factories */
export interface PluginContext {
  agents: AgentRegistry;
  tools: ToolRegistry;
  storage: StorageProvider;
  getModel: (id?: string) => LanguageModel;
  voice?: VoiceManager;
  cards: CardRegistry;
  maxDelegationDepth: number;
  defaultMaxSteps: number;
  config: CoreConfig;
}
```

**Step 2:** Create `streaming/sse-writer.ts` — web-standard SSE streaming that replaces Hono's `streamSSE`:

```ts
export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

export interface SSEWriter {
  writeSSE(message: SSEMessage): Promise<void>;
  close(): void;
}

/** Creates a web-standard Response with SSE content.
 *  The handler receives an SSEWriter to write events.
 *  Returns a Response with Content-Type: text/event-stream. */
export function createSSEStream(
  handler: (writer: SSEWriter) => Promise<void>,
  signal?: AbortSignal,
): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      // Stream was cancelled by the client
    },
  });

  const writer: SSEWriter = {
    async writeSSE({ event, data, id }) {
      let message = "";
      if (id) message += `id: ${id}\n`;
      message += `event: ${event}\n`;
      message += `data: ${data}\n\n`;
      try {
        controller.enqueue(encoder.encode(message));
      } catch {
        // Stream may be closed
      }
    },
    close() {
      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
  };

  // Run the handler asynchronously
  handler(writer)
    .catch(() => {})
    .finally(() => writer.close());

  // Handle abort
  if (signal) {
    signal.addEventListener("abort", () => writer.close(), { once: true });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

**Step 3:** Write a test for `createSSEStream` in `packages/core/test/sse-writer.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createSSEStream } from "../src/streaming/sse-writer.js";

describe("createSSEStream", () => {
  test("returns a Response with correct headers", async () => {
    const response = createSSEStream(async () => {});
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  test("writes SSE-formatted events", async () => {
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "test", data: '{"hello":"world"}', id: "1" });
    });
    const text = await response.text();
    expect(text).toContain("id: 1");
    expect(text).toContain("event: test");
    expect(text).toContain('data: {"hello":"world"}');
  });
});
```

**Step 4:** Run tests to verify.

**Step 5:** Commit: `"feat(core): add AgentRequest types and SSE writer"`

---

## Task 3: Move framework-agnostic files to core (no modifications)

These files have zero Hono imports and need only import path updates.

**Files to move** (copy from `packages/server/src/` to `packages/core/src/`):

**events/**
- `lib/agent-events.ts` → `events/agent-events.ts`
- `lib/events.ts` → `events/events.ts`
- `lib/emit-status.ts` → `events/emit-status.ts`

**utils/**
- `lib/ai-provider.ts` → `utils/ai-provider.ts`
- `lib/card-registry.ts` → `utils/card-registry.ts`
- `lib/constants.ts` → `utils/constants.ts`
- `lib/delegation-context.ts` → `utils/delegation-context.ts`
- `lib/request-registry.ts` → `utils/request-registry.ts`
- `lib/resilience.ts` → `utils/resilience.ts`
- `lib/compaction.ts` → `utils/compaction.ts`
- `lib/conversation-helpers.ts` → `utils/conversation-helpers.ts`
- `lib/tool-examples.ts` → `utils/tool-examples.ts`

**storage/**
- `storage/interfaces.ts` → `storage/interfaces.ts`
- `storage/skill-helpers.ts` → `storage/skill-helpers.ts`
- `storage/file-storage/` → `storage/file-storage/` (all files)
- `storage/in-memory/` → `storage/in-memory/` (all files)

**voice/**
- `voice/voice-provider.ts` → `voice/voice-provider.ts`
- `voice/voice-manager.ts` → `voice/voice-manager.ts`
- `voice/openai-voice-provider.ts` → `voice/openai-voice-provider.ts`

**registry/**
- `registry/tool-registry.ts` → `registry/tool-registry.ts`

**agents/**
- `agents/execute-task.ts` → `agents/execute-task.ts`
- `agents/memory-tool.ts` → `agents/memory-tool.ts`
- `lib/run-agent.ts` → `agents/run-agent.ts`

**schemas/** (from route schema files — these are pure Zod, no Hono)
- `routes/generate/generate.schemas.ts` → `schemas/generate.schemas.ts`
- `routes/agents/agents.schemas.ts` → `schemas/agents.schemas.ts`
- `routes/memory/memory.schemas.ts` → `schemas/memory.schemas.ts`
- `routes/skills/skills.schemas.ts` → `schemas/skills.schemas.ts`
- `routes/voice/voice.schemas.ts` → `schemas/voice.schemas.ts`

**Step 1:** Copy all files to their new locations.

**Step 2:** Update all internal import paths within the copied files to reflect the new directory structure. Every `../lib/foo.js` becomes `../utils/foo.js` or `../events/foo.js` etc. Every `../context.js` becomes `../types.js`.

Example transformations:
- `from "../lib/events.js"` → `from "../events/events.js"`
- `from "../lib/emit-status.js"` → `from "../events/emit-status.js"`
- `from "../lib/agent-events.js"` → `from "../events/agent-events.js"`
- `from "../lib/ai-provider.js"` → `from "../utils/ai-provider.js"`
- `from "../lib/delegation-context.js"` → `from "../utils/delegation-context.js"`
- `from "../lib/constants.js"` → `from "../utils/constants.js"`
- `from "../lib/resilience.js"` → `from "../utils/resilience.js"`
- `from "../lib/conversation-helpers.js"` → `from "../utils/conversation-helpers.js"`
- `from "../lib/request-registry.js"` → `from "../utils/request-registry.js"`
- `from "../lib/card-registry.js"` → `from "../utils/card-registry.js"`
- `from "../lib/tool-examples.js"` → `from "../utils/tool-examples.js"`
- `from "../lib/run-agent.js"` → `from "./run-agent.js"` (now in same agents/ dir)
- `from "../context.js"` → `from "../types.js"`

**Step 3:** Verify the core package builds: `bun run --cwd packages/core build`

**Step 4:** Commit: `"feat(core): move framework-agnostic files to core package"`

---

## Task 4: Move and modify Hono-coupled files to core

These files need Hono imports removed and replaced with the new abstractions.

**Files:**
- Move+modify: `registry/agent-registry.ts` → `core/src/registry/agent-registry.ts`
- Move+modify: `registry/handler-factories.ts` → `core/src/registry/handler-factories.ts`
- Create: `core/src/registry/index.ts` (barrel re-export)
- Move+modify: `lib/stream-helpers.ts` → `core/src/streaming/stream-helpers.ts`
- Move+modify: `agents/orchestrator.ts` → `core/src/agents/orchestrator.ts`

**Step 1:** `agent-registry.ts` — Replace `Context` with `AgentRequest`:

```ts
// Before:
import type { Context } from "hono";
export type AgentHandler = (c: Context, options: ...) => Response | Promise<Response>;

// After:
import type { AgentRequest } from "../types.js";
export type AgentHandler = (req: AgentRequest, options: ...) => Response | Promise<Response>;
```

Same for `ActionRegistration.handler`: `(c: Context)` → `(req: AgentRequest)`.

**Step 2:** `handler-factories.ts` — Replace `Context` usage with `AgentRequest`:

```ts
// Before:
import type { Context } from "hono";
return async (c: Context, { systemPrompt, memoryContext }) => {
  const { message, messages, conversationId: cid, model } = await c.req.json();
  // ...
  return streamAgentResponse(c, ctx, { ... });
};

// After:
import type { AgentRequest } from "../types.js";
return async (req: AgentRequest, { systemPrompt, memoryContext }) => {
  const { message, messages, conversationId: cid, model } = await req.json();
  // ...
  return streamAgentResponse(ctx, { ... }); // No more c parameter
};
```

For `makeRegistryJsonHandler`, replace `c.json(...)` with:
```ts
return new Response(JSON.stringify({ ...result, conversationId: generateConversationId(cid) }), {
  headers: { "Content-Type": "application/json" },
});
```

**Step 3:** `stream-helpers.ts` — Replace `streamSSE(c, ...)` with `createSSEStream(...)`:

```ts
// Before:
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
export function streamAgentResponse(c: Context, ctx: PluginContext, config: AgentStreamConfig) {
  // ...
  return streamSSE(c, async (stream) => { ... });
}

// After:
import { createSSEStream } from "./sse-writer.js";
export function streamAgentResponse(ctx: PluginContext, config: AgentStreamConfig) {
  // ...
  return createSSEStream(async (writer) => {
    // Replace stream.writeSSE with writer.writeSSE (same API shape)
    // ...
  }, abortSignal);
}
```

Note: The `streamAgentResponse` function signature drops the `c: Context` first parameter entirely. All callers will be updated.

**Step 4:** `orchestrator.ts` — The most complex file. Replace:
- `import { streamSSE } from "hono/streaming"` → `import { createSSEStream } from "../streaming/sse-writer.js"`
- `import type { Context } from "hono"` → `import type { AgentRequest } from "../types.js"`
- `streamSSE(c, async (stream) => { ... })` → `createSSEStream(async (writer) => { ... }, abortSignal)`
- `c.req.json()` → `req.json()`
- `c.req.raw.signal` → `req.raw.signal`
- `c.json({ ... }, 200)` → `new Response(JSON.stringify({ ... }), { headers: { "Content-Type": "application/json" } })`
- All internal `../lib/` imports → updated paths

The `createStreamWriter` helper already takes `{ writeSSE }` — this matches the `SSEWriter` interface from `sse-writer.ts`, so the bridge code works unchanged.

**Step 5:** Create `core/src/registry/index.ts` barrel:

```ts
export { AgentRegistry } from "./agent-registry.js";
export type { AgentRegistration, AgentHandler, ActionRegistration, GuardResult } from "./agent-registry.js";
export { ToolRegistry } from "./tool-registry.js";
export type { ToolRegistration } from "./tool-registry.js";
export { makeRegistryHandlers, makeRegistryStreamHandler, makeRegistryJsonHandler, generateConversationId } from "./handler-factories.js";
```

**Step 6:** Verify build: `bun run --cwd packages/core build`

**Step 7:** Commit: `"feat(core): port agent-registry, handler-factories, stream-helpers, orchestrator to core"`

---

## Task 5: Create core barrel exports (`index.ts`)

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1:** Write the complete barrel exports file, mirroring the current server's exports but pointing to core's paths. Exclude Hono-specific exports (`createAIPlugin`, `createApiKeyAuth`).

Follow the same pattern as the current `packages/server/src/index.ts` but with updated paths:
- `./registry/index.js` for registries
- `./agents/orchestrator.js` for orchestrator
- `./agents/execute-task.js`, `./agents/run-agent.js`, `./agents/memory-tool.js`
- `./events/agent-events.js`, `./events/events.js`, `./events/emit-status.js`
- `./utils/constants.js`, `./utils/card-registry.js`, `./utils/ai-provider.js`, etc.
- `./storage/interfaces.js`, `./storage/file-storage/index.js`, `./storage/in-memory/index.js`
- `./streaming/stream-helpers.js`, `./streaming/sse-writer.js`
- `./voice/voice-provider.js`, `./voice/voice-manager.js`, `./voice/openai-voice-provider.js`
- `./schemas/generate.schemas.js`, etc.
- `./types.js` for all type exports

**Step 2:** Verify build: `bun run --cwd packages/core build`

**Step 3:** Commit: `"feat(core): complete barrel exports"`

---

## Task 6: Rename `packages/server/` → `packages/hono/` and rewire

**Files:**
- Rename: `packages/server/` → `packages/hono/`
- Modify: `packages/hono/package.json` (name: `@kitnai/hono`, add `@kitnai/core` dependency)
- Modify: `packages/hono/src/index.ts` (re-export from `@kitnai/core` + own exports)
- Modify: `packages/hono/src/types.ts` (import from `@kitnai/core`, add Hono-specific types)
- Modify: `packages/hono/src/plugin.ts` (import from `@kitnai/core`)
- Create: `packages/hono/src/adapters/request-adapter.ts`
- Modify: all route files to import from `@kitnai/core` and use the request adapter
- Move: `packages/server/test/` → `packages/hono/test/`
- Modify: root `package.json` workspace config if needed

**Step 1:** Rename the directory.

**Step 2:** Update `package.json`:
```json
{
  "name": "@kitnai/hono",
  "dependencies": {
    "@kitnai/core": "workspace:*",
    "@scalar/hono-api-reference": "^0.9.41"
  },
  "peerDependencies": {
    "@hono/zod-openapi": "^1.2.2",
    "ai": "^6.0.91",
    "hono": "^4.11.10",
    "zod": "^4.3.6"
  }
}
```

**Step 3:** Create `adapters/request-adapter.ts`:

```ts
import type { Context } from "hono";
import type { AgentRequest } from "@kitnai/core";

/** Converts a Hono Context into the framework-agnostic AgentRequest interface */
export function toAgentRequest(c: Context): AgentRequest {
  return {
    json: <T>() => c.req.json<T>(),
    query: (key: string) => c.req.query(key),
    param: (key: string) => c.req.param(key),
    header: (key: string) => c.req.header(key),
    raw: c.req.raw,
  };
}
```

**Step 4:** Update `types.ts` — import core types, add Hono-specific types:

```ts
import type { MiddlewareHandler } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { CoreConfig, PluginContext } from "@kitnai/core";
import type { AgentRegistration, AgentRegistry, ToolRegistry, AgentHandler } from "@kitnai/core";
import type { CardRegistry } from "@kitnai/core";
import type { VoiceManager } from "@kitnai/core";
import type { StorageProvider, MemoryStore } from "@kitnai/core";
import type { OrchestratorAgentConfig } from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  authMiddleware?: MiddlewareHandler;
  voice?: VoiceConfig;
  memoryStore?: MemoryStore;
  openapi?: { title?: string; version?: string; description?: string; serverUrl?: string };
}

export interface VoiceConfig {
  retainAudio?: boolean;
}

export interface AIPluginInstance {
  app: OpenAPIHono;
  agents: AgentRegistry;
  tools: ToolRegistry;
  cards: CardRegistry;
  voice?: VoiceManager;
  initialize(): Promise<void>;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
}
```

**Step 5:** Update `plugin.ts` to import from `@kitnai/core`:

Replace all `./lib/...`, `./registry/...`, `./agents/...`, `./storage/...`, `./voice/...` imports with `@kitnai/core` imports. Keep `./routes/...` imports pointing to the local Hono routes.

**Step 6:** Update `index.ts` to re-export from `@kitnai/core`:

```ts
// Re-export everything from core for backwards compatibility
export * from "@kitnai/core";

// Hono-specific exports
export { createAIPlugin } from "./plugin.js";
export type { AIPluginConfig, AIPluginInstance, VoiceConfig } from "./types.js";
export { createApiKeyAuth } from "./lib/auth.js";
export { toAgentRequest } from "./adapters/request-adapter.js";
```

**Step 7:** Delete the files from `packages/hono/src/` that now live in core. These are all the files moved in Tasks 3 and 4. Keep only:
- `plugin.ts`, `types.ts`, `index.ts`
- `lib/auth.ts`, `lib/configure-openapi.ts`
- `routes/**`
- `adapters/request-adapter.ts`

**Step 8:** Update all route handler files to import from `@kitnai/core` instead of `../lib/...`, and use the `toAgentRequest` adapter where handlers call core functions that expect `AgentRequest`.

**Step 9:** Run `bun install` to update workspace links.

**Step 10:** Verify build: `bun run --cwd packages/core build && bun run --cwd packages/hono build`

**Step 11:** Commit: `"feat: rename @kitnai/server → @kitnai/hono, wire to @kitnai/core"`

---

## Task 7: Update examples and external references

**Files:**
- Modify: `examples/getting-started/package.json` (`@kitnai/server` → `@kitnai/hono`)
- Modify: `examples/getting-started/src/index.ts` (import from `@kitnai/hono`)
- Modify: `examples/api/package.json` (if it exists, same rename)
- Modify: `examples/api/src/index.ts` (if it exists)
- Modify: `packages/cli/` (if it references `@kitnai/server`)
- Modify: root `package.json` workspace config (if `packages/server` is listed)

**Step 1:** Find and replace all `@kitnai/server` references with `@kitnai/hono` across examples and config.

**Step 2:** Run `bun install` to resolve workspace changes.

**Step 3:** Verify examples typecheck: `bun run --cwd packages/hono build && bun run --cwd examples/getting-started typecheck`

**Step 4:** Commit: `"chore: update examples and references for @kitnai/hono rename"`

---

## Task 8: Move and update tests

**Files:**
- Move: core-related tests to `packages/core/test/`
- Keep: Hono-specific tests in `packages/hono/test/`
- Modify: `packages/core/test/helpers.ts` (shared test helpers)

**Tests that move to core:**
- `orchestrator.test.ts` — tests orchestrator logic (needs test helper updates for AgentRequest)
- `card-registry.test.ts` — tests CardRegistry (pure core)
- `memory-store.test.ts` — tests in-memory store (pure core)
- `resilience.test.ts` — tests withResilience (pure core)
- `exports.test.ts` — needs to be split: core exports test + hono exports test
- `utils.test.ts` — tests AI provider utils (pure core)
- `helpers.ts` — shared test helper factory (needs updating for AgentRequest)

**Tests that stay in hono:**
- `routes.test.ts` — tests HTTP routes via Hono
- `plugin.test.ts` — tests createAIPlugin factory (Hono-specific)

**Step 1:** Copy test files to appropriate locations. Update imports from `../src/...` to `@kitnai/core` or `@kitnai/hono`.

**Step 2:** Update `helpers.ts` in core tests — the test helper creates mock contexts. Replace any Hono `Context` mocks with `AgentRequest` mocks.

**Step 3:** Update `exports.test.ts` — split into core exports verification and hono exports verification.

**Step 4:** Run all tests: `bun test`

**Step 5:** Verify all tests pass (should be 183+ tests).

**Step 6:** Commit: `"test: split tests between core and hono packages"`

---

## Task 9: Final verification and cleanup

**Step 1:** Full test suite: `bun test` — all tests pass.

**Step 2:** Build all packages:
```bash
bun run --cwd packages/core build
bun run --cwd packages/hono build
bun run --cwd packages/cli build
```

**Step 3:** Registry validation:
```bash
bun run --cwd registry validate
bun run --cwd registry typecheck
bun run --cwd registry build
```

**Step 4:** Example typecheck:
```bash
bun run --cwd examples/getting-started typecheck
```

**Step 5:** Verify no Hono imports in core:
```bash
grep -r "from.*hono" packages/core/src/ && echo "FAIL: Hono imports in core" || echo "OK: No Hono in core"
```

**Step 6:** Verify no stale files left in hono that should be in core:
```bash
ls packages/hono/src/lib/agent-events.ts 2>/dev/null && echo "FAIL: stale file" || echo "OK"
```

**Step 7:** Clean up any TODO comments or temporary code.

**Step 8:** Commit: `"chore: final cleanup and verification"`

---

## Task Dependency Order

```
Task 1 (scaffold) → Task 2 (types + SSE writer) → Task 3 (move clean files) → Task 4 (move + modify files) → Task 5 (barrel exports) → Task 6 (rename + rewire) → Task 7 (examples) → Task 8 (tests) → Task 9 (verify)
```

Tasks are strictly sequential — each builds on the previous.

## Key Risk: The orchestrator.ts refactor (Task 4)

`orchestrator.ts` is 535 lines with dense SSE streaming logic. The refactor touches:
- Both `buildSseHandler` functions (2 occurrences of `streamSSE(c, ...)`)
- The `buildJsonHandler` function (`c.req.json()`, `c.json()`)
- The `c.req.raw.signal` access for abort handling

Strategy: Replace `streamSSE(c, async (stream) =>` with `createSSEStream(async (writer) =>` — the `createStreamWriter` internal helper already accepts `{ writeSSE }` which matches the `SSEWriter` interface. The `stream.writeSSE` calls translate directly.

For JSON handlers, replace `c.json(data, status)` with `new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })`.
