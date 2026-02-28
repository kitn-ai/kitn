# Lifecycle Hooks & Background Jobs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lifecycle hooks (structured execution events with plugin-level subscription) and opt-in background execution (JobStore, async mode, reconnectable SSE) to kitn core.

**Architecture:** Core provides a `LifecycleHookEmitter` on the plugin for structured execution events (two levels: summary + trace). Background execution is opt-in via `?async=true` — adds `JobStore` as 9th sub-store in `StorageProvider`, detaches agent execution from HTTP lifecycle, supports reconnectable SSE and job cancellation. Registry add-ons (loggers, webhooks) are separate follow-up work.

**Tech Stack:** TypeScript, Bun, Hono, AI SDK, existing kitn patterns (AgentEventBus, CronStore, handler-factories)

**Design Doc:** `docs/plans/2026-02-28-lifecycle-hooks-jobs-design.md`

---

## Phase 1: Lifecycle Hooks

### Task 1: LifecycleHookEmitter Class

**Files:**
- Create: `packages/core/src/hooks/lifecycle-hooks.ts`
- Create: `packages/core/src/hooks/index.ts`
- Test: `packages/core/src/hooks/lifecycle-hooks.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/core/src/hooks/lifecycle-hooks.test.ts
import { describe, test, expect, mock } from "bun:test";
import { createLifecycleHooks } from "./lifecycle-hooks.js";

describe("LifecycleHookEmitter", () => {
  test("subscribes and receives events", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const handler = mock(() => {});

    hooks.on("agent:end", handler);
    hooks.emit("agent:end", { agentName: "test", output: "hi", duration: 100 } as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ agentName: "test" });
  });

  test("unsubscribes correctly", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const handler = mock(() => {});

    const unsub = hooks.on("agent:end", handler);
    unsub();
    hooks.emit("agent:end", { agentName: "test" } as any);

    expect(handler).not.toHaveBeenCalled();
  });

  test("wildcard receives all events", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const handler = mock(() => {});

    hooks.on("*", handler);
    hooks.emit("agent:start", { agentName: "a" } as any);
    hooks.emit("agent:end", { agentName: "a" } as any);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0]).toMatchObject({ type: "agent:start" });
    expect(handler.mock.calls[1][0]).toMatchObject({ type: "agent:end" });
  });

  test("handler errors do not propagate", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const badHandler = mock(() => { throw new Error("boom"); });
    const goodHandler = mock(() => {});

    hooks.on("agent:end", badHandler);
    hooks.on("agent:end", goodHandler);

    // Should not throw
    hooks.emit("agent:end", { agentName: "test" } as any);

    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  test("trace events only fire at trace level", () => {
    const summaryHooks = createLifecycleHooks({ level: "summary" });
    const traceHooks = createLifecycleHooks({ level: "trace" });
    const summaryHandler = mock(() => {});
    const traceHandler = mock(() => {});

    summaryHooks.on("tool:execute", summaryHandler);
    traceHooks.on("tool:execute", traceHandler);

    summaryHooks.emit("tool:execute", { toolName: "test" } as any);
    traceHooks.emit("tool:execute", { toolName: "test" } as any);

    expect(summaryHandler).not.toHaveBeenCalled();
    expect(traceHandler).toHaveBeenCalledTimes(1);
  });

  test("summary events fire at both levels", () => {
    const summaryHooks = createLifecycleHooks({ level: "summary" });
    const traceHooks = createLifecycleHooks({ level: "trace" });
    const h1 = mock(() => {});
    const h2 = mock(() => {});

    summaryHooks.on("agent:end", h1);
    traceHooks.on("agent:end", h2);

    summaryHooks.emit("agent:end", { agentName: "test" } as any);
    traceHooks.emit("agent:end", { agentName: "test" } as any);

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/hooks/lifecycle-hooks.test.ts`
Expected: FAIL — module not found

**Step 3: Implement LifecycleHookEmitter**

```typescript
// packages/core/src/hooks/lifecycle-hooks.ts

export interface LifecycleHookConfig {
  /** "summary" emits completion events only. "trace" adds tool/model/delegation detail. */
  level: "summary" | "trace";
}

// --- Summary-level event payloads ---

export interface AgentStartEvent {
  agentName: string;
  input: string;
  conversationId: string;
  scopeId?: string;
  jobId?: string;
  timestamp: string;
}

export interface AgentEndEvent {
  agentName: string;
  input: string;
  output: string;
  toolsUsed: string[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  duration: number;
  conversationId: string;
  scopeId?: string;
  jobId?: string;
  timestamp: string;
}

export interface AgentErrorEvent {
  agentName: string;
  input: string;
  error: string;
  duration: number;
  conversationId: string;
  scopeId?: string;
  jobId?: string;
  timestamp: string;
}

export interface JobStartEvent {
  jobId: string;
  agentName: string;
  input: string;
  conversationId: string;
  scopeId?: string;
  timestamp: string;
}

export interface JobEndEvent {
  jobId: string;
  agentName: string;
  output: string;
  duration: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  timestamp: string;
}

export interface JobCancelledEvent {
  jobId: string;
  agentName: string;
  duration: number;
  timestamp: string;
}

export interface CronExecutedEvent {
  cronId: string;
  agentName: string;
  executionId: string;
  status: "completed" | "failed";
  duration: number;
  timestamp: string;
}

// --- Trace-level event payloads ---

export interface ToolExecuteEvent {
  agentName: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  duration: number;
  conversationId: string;
  timestamp: string;
}

export interface DelegateStartEvent {
  parentAgent: string;
  childAgent: string;
  input: string;
  conversationId: string;
  timestamp: string;
}

export interface DelegateEndEvent {
  parentAgent: string;
  childAgent: string;
  output: string;
  duration: number;
  conversationId: string;
  timestamp: string;
}

export interface ModelCallEvent {
  agentName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  duration: number;
  conversationId: string;
  timestamp: string;
}

// --- Event map ---

export interface SummaryHookEvents {
  "agent:start": AgentStartEvent;
  "agent:end": AgentEndEvent;
  "agent:error": AgentErrorEvent;
  "job:start": JobStartEvent;
  "job:end": JobEndEvent;
  "job:cancelled": JobCancelledEvent;
  "cron:executed": CronExecutedEvent;
}

export interface TraceHookEvents {
  "tool:execute": ToolExecuteEvent;
  "delegate:start": DelegateStartEvent;
  "delegate:end": DelegateEndEvent;
  "model:call": ModelCallEvent;
}

export type AllHookEvents = SummaryHookEvents & TraceHookEvents;

export type HookEventType = keyof AllHookEvents;

export type WildcardEvent = { type: string } & Record<string, unknown>;

const TRACE_EVENTS = new Set<string>([
  "tool:execute",
  "delegate:start",
  "delegate:end",
  "model:call",
]);

// --- Emitter ---

export interface LifecycleHookEmitter {
  on<E extends keyof AllHookEvents>(
    event: E,
    handler: (data: AllHookEvents[E]) => void,
  ): () => void;
  on(event: "*", handler: (data: WildcardEvent) => void): () => void;
  emit<E extends keyof AllHookEvents>(event: E, data: AllHookEvents[E]): void;
}

export function createLifecycleHooks(
  config: LifecycleHookConfig,
): LifecycleHookEmitter {
  const handlers = new Map<string, Array<(data: any) => void>>();

  return {
    on(event: string, handler: (data: any) => void): () => void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },

    emit(event: string, data: any): void {
      // Skip trace events when level is "summary"
      if (config.level === "summary" && TRACE_EVENTS.has(event)) return;

      // Fire specific handlers
      const specific = handlers.get(event);
      if (specific) {
        for (const handler of specific) {
          try {
            handler(data);
          } catch {
            // Swallow errors — hooks must not break execution
          }
        }
      }

      // Fire wildcard handlers
      const wildcards = handlers.get("*");
      if (wildcards) {
        const wildcardData = { type: event, ...data };
        for (const handler of wildcards) {
          try {
            handler(wildcardData);
          } catch {
            // Swallow errors
          }
        }
      }
    },
  };
}
```

**Step 4: Create index.ts**

```typescript
// packages/core/src/hooks/index.ts
export {
  createLifecycleHooks,
  type LifecycleHookConfig,
  type LifecycleHookEmitter,
  type AllHookEvents,
  type HookEventType,
  type SummaryHookEvents,
  type TraceHookEvents,
  type AgentStartEvent,
  type AgentEndEvent,
  type AgentErrorEvent,
  type JobStartEvent,
  type JobEndEvent,
  type JobCancelledEvent,
  type CronExecutedEvent,
  type ToolExecuteEvent,
  type DelegateStartEvent,
  type DelegateEndEvent,
  type ModelCallEvent,
} from "./lifecycle-hooks.js";
```

**Step 5: Run tests to verify they pass**

Run: `bun test packages/core/src/hooks/lifecycle-hooks.test.ts`
Expected: All 6 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/hooks/
git commit -m "feat(core): add LifecycleHookEmitter with summary and trace levels"
```

---

### Task 2: Integrate Hooks into PluginContext

**Files:**
- Modify: `packages/core/src/types.ts:57-85`
- Modify: `packages/core/src/index.ts:26-32`
- Modify: `packages/adapters/hono/src/plugin.ts:28-62`

**Step 1: Add hooks to CoreConfig and PluginContext**

In `packages/core/src/types.ts`:
- Import `LifecycleHookConfig` and `LifecycleHookEmitter` from `./hooks/index.js`
- Add `hooks?: LifecycleHookConfig;` to `CoreConfig` (after `compaction?`)
- Add `waitUntil?: (promise: Promise<unknown>) => void;` to `CoreConfig`
- Add `hooks?: LifecycleHookEmitter;` to `PluginContext` (after `cronScheduler?`)

**Step 2: Export hooks from core index**

In `packages/core/src/index.ts`, add after the events section:

```typescript
// Hooks
export {
  createLifecycleHooks,
  type LifecycleHookConfig,
  type LifecycleHookEmitter,
  type AllHookEvents,
  type HookEventType,
  type SummaryHookEvents,
  type TraceHookEvents,
  type AgentStartEvent,
  type AgentEndEvent,
  type AgentErrorEvent,
  type JobStartEvent,
  type JobEndEvent,
  type JobCancelledEvent,
  type CronExecutedEvent,
  type ToolExecuteEvent,
  type DelegateStartEvent,
  type DelegateEndEvent,
  type ModelCallEvent,
} from "./hooks/index.js";
```

**Step 3: Initialize hooks in createAIPlugin**

In `packages/adapters/hono/src/plugin.ts`, inside `createAIPlugin()`:
- Import `createLifecycleHooks` from `@kitnai/core`
- After storage/agent/tool setup, before building `ctx`:
  ```typescript
  const hooks = config.hooks
    ? createLifecycleHooks(config.hooks)
    : undefined;
  ```
- Add `hooks` to the `PluginContext` object construction
- Expose `plugin.on()` as a convenience method that delegates to `ctx.hooks?.on()`

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors)

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/adapters/hono/src/plugin.ts
git commit -m "feat(core): integrate lifecycle hooks into PluginContext and plugin factory"
```

---

### Task 3: Emit Summary Hooks from Handler Factories

**Files:**
- Modify: `packages/core/src/registry/handler-factories.ts:15-108`

This is where agent execution starts and ends for both SSE and JSON modes. We emit `agent:start` before execution and `agent:end` / `agent:error` after.

**Step 1: Add hook emission to makeRegistryStreamHandler**

In `makeRegistryStreamHandler`, before the `streamAgentResponse` call (~line 44):
```typescript
const startTime = performance.now();
ctx.hooks?.emit("agent:start", {
  agentName: config.agentName ?? "unknown",
  input: message,
  conversationId,
  scopeId,
  timestamp: new Date().toISOString(),
});
```

In the `onStreamComplete` callback (~line 51), after persisting the assistant message:
```typescript
ctx.hooks?.emit("agent:end", {
  agentName: config.agentName ?? "unknown",
  input: message,
  output: text,
  toolsUsed: toolCalls,
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, // filled from stream result if available
  duration: performance.now() - startTime,
  conversationId,
  scopeId,
  timestamp: new Date().toISOString(),
});
```

Wrap the streaming call in try/catch to emit `agent:error` on failure.

**Step 2: Add hook emission to makeRegistryJsonHandler**

Same pattern. In `makeRegistryJsonHandler`, before `runAgent` (~line 86):
```typescript
const startTime = performance.now();
ctx.hooks?.emit("agent:start", { ... });
```

After `runAgent` returns (~line 94):
```typescript
ctx.hooks?.emit("agent:end", {
  agentName: config.agentName ?? "unknown",
  input: message,
  output: result.response,
  toolsUsed: result.toolsUsed,
  usage: result.usage,
  duration: performance.now() - startTime,
  conversationId,
  scopeId,
  timestamp: new Date().toISOString(),
});
```

In the catch block:
```typescript
ctx.hooks?.emit("agent:error", {
  agentName: config.agentName ?? "unknown",
  input: message,
  error: err.message,
  duration: performance.now() - startTime,
  conversationId,
  scopeId,
  timestamp: new Date().toISOString(),
});
```

**Step 3: Run typecheck and existing tests**

Run: `bun run typecheck && bun run --cwd packages/core test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/registry/handler-factories.ts
git commit -m "feat(core): emit agent lifecycle hooks from handler factories"
```

---

### Task 4: Emit cron:executed Hook

**Files:**
- Modify: `packages/core/src/crons/execute-cron.ts:11-84`

**Step 1: Add hook emission to executeCronJob**

After execution completes (both success and failure paths, ~line 50 and ~line 57), emit `cron:executed`:

```typescript
ctx.hooks?.emit("cron:executed", {
  cronId: job.id,
  agentName: job.agentName,
  executionId: execution.id,
  status: execution.status as "completed" | "failed",
  duration: new Date(execution.completedAt!).getTime() - new Date(execution.startedAt).getTime(),
  timestamp: new Date().toISOString(),
});
```

Place this after the execution status is updated but before the job's `lastRun`/`nextRun` are updated.

**Step 2: Run existing cron tests**

Run: `bun test packages/core/src/crons/`
Expected: PASS (existing tests unaffected — hooks are optional)

**Step 3: Commit**

```bash
git add packages/core/src/crons/execute-cron.ts
git commit -m "feat(core): emit cron:executed lifecycle hook from executeCronJob"
```

---

### Task 5: Emit Trace-Level Hooks

**Files:**
- Modify: `packages/core/src/agents/run-agent.ts:48-66`
- Modify: `packages/core/src/agents/orchestrator.ts:184-186, 278-389`

These only fire when `hooks.level === "trace"`. The emitter handles the filtering — we just call `emit()` and it's a no-op at summary level.

**Step 1: Emit tool:execute from run-agent.ts**

In the existing loop where `BUS_EVENTS.TOOL_CALL` and `BUS_EVENTS.TOOL_RESULT` are emitted (~lines 48-66), also emit the lifecycle hook. Because `tool:execute` includes both input and output, emit it after the tool result is available:

```typescript
// After processing each tool result in the step loop:
ctx.hooks?.emit("tool:execute", {
  agentName: config.agentName ?? "unknown",
  toolName: tr.toolName,
  input: tc.args ?? {},
  output: tr.result,
  duration: 0, // tool-level timing not available from AI SDK
  conversationId: "", // not available in run-agent context
  timestamp: new Date().toISOString(),
});
```

Note: Tool-level timing is not available from the AI SDK's `generateText` response (tools run inside the SDK). The `duration: 0` is a known limitation. The `conversationId` will need to be threaded through the config or pulled from DelegationContext if available.

**Step 2: Emit delegate:start and delegate:end from orchestrator.ts**

In the orchestrator's `executeTask` function or the `routeToAgent` tool executor (~line 184):

Before delegation:
```typescript
ctx.hooks?.emit("delegate:start", {
  parentAgent: agentName,
  childAgent: agent,
  input: query,
  conversationId: config.conversationId ?? "",
  timestamp: new Date().toISOString(),
});
```

After delegation returns:
```typescript
ctx.hooks?.emit("delegate:end", {
  parentAgent: agentName,
  childAgent: agent,
  output: taskResult.result?.response ?? "",
  duration: /* track timing around executeTask call */,
  conversationId: config.conversationId ?? "",
  timestamp: new Date().toISOString(),
});
```

**Step 3: Run tests**

Run: `bun run --cwd packages/core test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/agents/run-agent.ts packages/core/src/agents/orchestrator.ts
git commit -m "feat(core): emit trace-level lifecycle hooks (tool:execute, delegate:start/end)"
```

---

## Phase 2: Background Execution

### Task 6: Job Interface and JobStore

**Files:**
- Modify: `packages/core/src/storage/interfaces.ts:351-360`

**Step 1: Add Job and JobStore interfaces**

Add before `StorageProvider` in `interfaces.ts`:

```typescript
// --- Jobs ---

export interface Job {
  id: string;
  agentName: string;
  input: string;
  conversationId: string;
  scopeId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolsUsed?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobStore {
  create(job: Omit<Job, "id" | "createdAt">): Promise<Job>;
  get(id: string, scopeId?: string): Promise<Job | null>;
  list(scopeId?: string): Promise<Job[]>;
  update(id: string, updates: Partial<Omit<Job, "id">>): Promise<Job>;
  delete(id: string, scopeId?: string): Promise<boolean>;
}
```

Add `jobs: JobStore;` to `StorageProvider` (after `crons: CronStore;`).

**Step 2: Export Job types from core index**

In `packages/core/src/index.ts`, add to the storage types export section:
```typescript
export type { Job, JobStore } from "./storage/interfaces.js";
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: FAIL — `createFileStorage` and `createMemoryStorage` don't provide `jobs` yet. This is expected and will be fixed in Tasks 7-8.

**Step 4: Commit**

```bash
git add packages/core/src/storage/interfaces.ts packages/core/src/index.ts
git commit -m "feat(core): add Job and JobStore interfaces to StorageProvider"
```

---

### Task 7: In-Memory JobStore Implementation

**Files:**
- Create: `packages/core/src/storage/in-memory/job-store.ts`
- Create: `packages/core/src/storage/in-memory/job-store.test.ts`
- Modify: `packages/core/src/storage/in-memory/index.ts:325-336`

**Step 1: Write failing tests**

```typescript
// packages/core/src/storage/in-memory/job-store.test.ts
import { describe, test, expect } from "bun:test";
import { createJobStore } from "./job-store.js";

describe("In-Memory JobStore", () => {
  test("creates a job with generated id and timestamp", async () => {
    const store = createJobStore();
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    expect(job.id).toBeTruthy();
    expect(job.createdAt).toBeTruthy();
    expect(job.agentName).toBe("test-agent");
    expect(job.status).toBe("queued");
  });

  test("gets a job by id", async () => {
    const store = createJobStore();
    const created = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  test("returns null for non-existent job", async () => {
    const store = createJobStore();
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  test("lists all jobs", async () => {
    const store = createJobStore();
    await store.create({ agentName: "a", input: "1", conversationId: "c1", status: "queued" });
    await store.create({ agentName: "b", input: "2", conversationId: "c2", status: "queued" });

    const jobs = await store.list();
    expect(jobs).toHaveLength(2);
  });

  test("updates a job", async () => {
    const store = createJobStore();
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const updated = await store.update(job.id, {
      status: "completed",
      result: "done",
      completedAt: new Date().toISOString(),
    });

    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("done");
    expect(updated.agentName).toBe("test-agent");
  });

  test("deletes a job", async () => {
    const store = createJobStore();
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const deleted = await store.delete(job.id);
    expect(deleted).toBe(true);

    const fetched = await store.get(job.id);
    expect(fetched).toBeNull();
  });

  test("scopes jobs by scopeId", async () => {
    const store = createJobStore();
    await store.create({ agentName: "a", input: "1", conversationId: "c1", status: "queued", scopeId: "scope1" });
    await store.create({ agentName: "b", input: "2", conversationId: "c2", status: "queued", scopeId: "scope2" });

    const scope1Jobs = await store.list("scope1");
    expect(scope1Jobs).toHaveLength(1);
    expect(scope1Jobs[0].agentName).toBe("a");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/storage/in-memory/job-store.test.ts`
Expected: FAIL — module not found

**Step 3: Implement in-memory JobStore**

Follow the exact pattern from `packages/core/src/storage/in-memory/cron-store.ts`:

```typescript
// packages/core/src/storage/in-memory/job-store.ts
import type { Job, JobStore } from "../interfaces.js";

export function createJobStore(): JobStore {
  const jobs = new Map<string, Job>();
  let nextId = 1;

  function key(id: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${id}` : `:${id}`;
  }

  function prefix(scopeId?: string): string {
    return scopeId ? `${scopeId}:` : `:`;
  }

  return {
    async create(input) {
      const id = `job_${nextId++}`;
      const job: Job = {
        ...input,
        id,
        createdAt: new Date().toISOString(),
      };
      jobs.set(key(id, input.scopeId), job);
      return job;
    },

    async get(id, scopeId?) {
      return jobs.get(key(id, scopeId)) ?? null;
    },

    async list(scopeId?) {
      const p = prefix(scopeId);
      const result: Job[] = [];
      for (const [k, v] of jobs) {
        if (k.startsWith(p)) result.push(v);
      }
      return result;
    },

    async update(id, updates) {
      // Find the job across all scopes (update uses job id, not scope)
      for (const [k, v] of jobs) {
        if (v.id === id) {
          const updated = { ...v, ...updates, id: v.id };
          jobs.set(k, updated);
          return updated;
        }
      }
      throw new Error(`Job not found: ${id}`);
    },

    async delete(id, scopeId?) {
      return jobs.delete(key(id, scopeId));
    },
  };
}
```

**Step 4: Wire into createMemoryStorage**

In `packages/core/src/storage/in-memory/index.ts`:
- Import `createJobStore` from `./job-store.js`
- Add `jobs: createJobStore(),` to the returned object (after `crons`)

**Step 5: Run tests**

Run: `bun test packages/core/src/storage/in-memory/job-store.test.ts`
Expected: All 7 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/storage/in-memory/job-store.ts packages/core/src/storage/in-memory/job-store.test.ts packages/core/src/storage/in-memory/index.ts
git commit -m "feat(core): add in-memory JobStore implementation"
```

---

### Task 8: File-Based JobStore Implementation

**Files:**
- Create: `packages/core/src/storage/file-storage/job-store.ts`
- Create: `packages/core/src/storage/file-storage/job-store.test.ts`
- Modify: `packages/core/src/storage/file-storage/index.ts:17-30`

**Step 1: Write failing tests**

Same test structure as Task 7 but using `createFileJobStore(tempDir)`. Use `mkdtemp` for a temp directory in each test. Follow the pattern from existing file-storage tests if any exist, otherwise:

```typescript
// packages/core/src/storage/file-storage/job-store.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileJobStore } from "./job-store.js";

describe("File-Based JobStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kitn-job-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("creates a job with generated id", async () => {
    const store = createFileJobStore(dataDir);
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    expect(job.id).toBeTruthy();
    expect(job.createdAt).toBeTruthy();
    expect(job.agentName).toBe("test-agent");
  });

  test("persists and retrieves a job", async () => {
    const store = createFileJobStore(dataDir);
    const created = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  test("returns null for non-existent job", async () => {
    const store = createFileJobStore(dataDir);
    expect(await store.get("nope")).toBeNull();
  });

  test("lists all jobs", async () => {
    const store = createFileJobStore(dataDir);
    await store.create({ agentName: "a", input: "1", conversationId: "c1", status: "queued" });
    await store.create({ agentName: "b", input: "2", conversationId: "c2", status: "queued" });

    const jobs = await store.list();
    expect(jobs).toHaveLength(2);
  });

  test("updates a job", async () => {
    const store = createFileJobStore(dataDir);
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const updated = await store.update(job.id, { status: "completed", result: "done" });
    expect(updated.status).toBe("completed");

    // Verify persistence
    const fetched = await store.get(job.id);
    expect(fetched?.status).toBe("completed");
  });

  test("deletes a job", async () => {
    const store = createFileJobStore(dataDir);
    const job = await store.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    expect(await store.delete(job.id)).toBe(true);
    expect(await store.get(job.id)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/storage/file-storage/job-store.test.ts`
Expected: FAIL — module not found

**Step 3: Implement file-based JobStore**

Follow the exact pattern from `packages/core/src/storage/file-storage/cron-store.ts`:

```typescript
// packages/core/src/storage/file-storage/job-store.ts
import { join } from "node:path";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import type { Job, JobStore } from "../interfaces.js";

export function createFileJobStore(dataDir: string): JobStore {
  const baseDir = join(dataDir, "jobs");

  let lock: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = lock.then(fn, fn);
    lock = next.then(() => {}, () => {});
    return next;
  }

  function scopeDir(scopeId?: string): string {
    return scopeId ? join(dataDir, "scopes", scopeId, "jobs") : baseDir;
  }

  function jobPath(id: string, scopeId?: string): string {
    return join(scopeDir(scopeId), `${id}.json`);
  }

  let nextId = Date.now();

  return {
    create(input) {
      return withLock(async () => {
        const dir = scopeDir(input.scopeId);
        await mkdir(dir, { recursive: true });

        const id = `job_${nextId++}_${Math.random().toString(36).slice(2, 8)}`;
        const job: Job = {
          ...input,
          id,
          createdAt: new Date().toISOString(),
        };

        await writeFile(jobPath(id, input.scopeId), JSON.stringify(job, null, 2));
        return job;
      });
    },

    async get(id, scopeId?) {
      try {
        const data = await readFile(jobPath(id, scopeId), "utf-8");
        return JSON.parse(data) as Job;
      } catch {
        return null;
      }
    },

    async list(scopeId?) {
      const dir = scopeDir(scopeId);
      try {
        const files = await readdir(dir);
        const jobs: Job[] = [];
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const data = await readFile(join(dir, file), "utf-8");
            jobs.push(JSON.parse(data) as Job);
          } catch {
            // Skip corrupt files
          }
        }
        return jobs;
      } catch {
        return [];
      }
    },

    update(id, updates) {
      return withLock(async () => {
        // Try base dir first, then search scopes
        const path = jobPath(id, updates.scopeId);
        try {
          const data = await readFile(path, "utf-8");
          const job = JSON.parse(data) as Job;
          const updated = { ...job, ...updates, id: job.id };
          await writeFile(path, JSON.stringify(updated, null, 2));
          return updated;
        } catch {
          // Try without scope
          const basePath = jobPath(id);
          const data = await readFile(basePath, "utf-8");
          const job = JSON.parse(data) as Job;
          const updated = { ...job, ...updates, id: job.id };
          await writeFile(basePath, JSON.stringify(updated, null, 2));
          return updated;
        }
      });
    },

    delete(id, scopeId?) {
      return withLock(async () => {
        try {
          await unlink(jobPath(id, scopeId));
          return true;
        } catch {
          return false;
        }
      });
    },
  };
}
```

**Step 4: Wire into createFileStorage**

In `packages/core/src/storage/file-storage/index.ts`:
- Import `createFileJobStore` from `./job-store.js`
- Add `jobs: createFileJobStore(dataDir),` to the returned object (after `crons`)

**Step 5: Run tests**

Run: `bun test packages/core/src/storage/file-storage/job-store.test.ts`
Expected: All 6 tests PASS

**Step 6: Run typecheck to verify StorageProvider is satisfied**

Run: `bun run typecheck`
Expected: PASS — both `createFileStorage` and `createMemoryStorage` now provide `jobs`

**Step 7: Commit**

```bash
git add packages/core/src/storage/file-storage/job-store.ts packages/core/src/storage/file-storage/job-store.test.ts packages/core/src/storage/file-storage/index.ts
git commit -m "feat(core): add file-based JobStore implementation"
```

---

### Task 9: Background Execution Logic

**Files:**
- Create: `packages/core/src/jobs/execute-job.ts`
- Create: `packages/core/src/jobs/event-buffer.ts`
- Create: `packages/core/src/jobs/index.ts`
- Test: `packages/core/src/jobs/event-buffer.test.ts`

**Step 1: Write tests for EventBuffer**

```typescript
// packages/core/src/jobs/event-buffer.test.ts
import { describe, test, expect } from "bun:test";
import { createEventBuffer } from "./event-buffer.js";

describe("EventBuffer", () => {
  test("stores and replays events", () => {
    const buffer = createEventBuffer();
    buffer.push("job_1", { id: "1", event: "text-delta", data: "hello" });
    buffer.push("job_1", { id: "2", event: "done", data: "{}" });

    const events = buffer.replay("job_1");
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("text-delta");
  });

  test("returns empty array for unknown job", () => {
    const buffer = createEventBuffer();
    expect(buffer.replay("unknown")).toEqual([]);
  });

  test("cleans up buffer for a job", () => {
    const buffer = createEventBuffer();
    buffer.push("job_1", { id: "1", event: "text-delta", data: "hello" });
    buffer.cleanup("job_1");
    expect(buffer.replay("job_1")).toEqual([]);
  });

  test("tracks whether a job has active listeners", () => {
    const buffer = createEventBuffer();
    expect(buffer.hasListeners("job_1")).toBe(false);

    const unsub = buffer.addListener("job_1", () => {});
    expect(buffer.hasListeners("job_1")).toBe(true);

    unsub();
    expect(buffer.hasListeners("job_1")).toBe(false);
  });

  test("notifies listeners on push", () => {
    const buffer = createEventBuffer();
    const received: any[] = [];

    buffer.addListener("job_1", (event) => received.push(event));
    buffer.push("job_1", { id: "1", event: "text-delta", data: "hello" });

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe("text-delta");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/jobs/event-buffer.test.ts`
Expected: FAIL — module not found

**Step 3: Implement EventBuffer**

```typescript
// packages/core/src/jobs/event-buffer.ts

export interface BufferedEvent {
  id: string;
  event: string;
  data: string;
}

type EventListener = (event: BufferedEvent) => void;

export interface EventBuffer {
  push(jobId: string, event: BufferedEvent): void;
  replay(jobId: string): BufferedEvent[];
  cleanup(jobId: string): void;
  addListener(jobId: string, listener: EventListener): () => void;
  hasListeners(jobId: string): boolean;
}

export function createEventBuffer(): EventBuffer {
  const buffers = new Map<string, BufferedEvent[]>();
  const listeners = new Map<string, Set<EventListener>>();

  return {
    push(jobId, event) {
      // Store in buffer
      const buf = buffers.get(jobId) ?? [];
      buf.push(event);
      buffers.set(jobId, buf);

      // Notify live listeners
      const subs = listeners.get(jobId);
      if (subs) {
        for (const listener of subs) {
          try {
            listener(event);
          } catch {
            // Swallow
          }
        }
      }
    },

    replay(jobId) {
      return buffers.get(jobId) ?? [];
    },

    cleanup(jobId) {
      buffers.delete(jobId);
      listeners.delete(jobId);
    },

    addListener(jobId, listener) {
      const subs = listeners.get(jobId) ?? new Set();
      subs.add(listener);
      listeners.set(jobId, subs);
      return () => {
        subs.delete(listener);
        if (subs.size === 0) listeners.delete(jobId);
      };
    },

    hasListeners(jobId) {
      const subs = listeners.get(jobId);
      return subs != null && subs.size > 0;
    },
  };
}
```

**Step 4: Implement executeJobInBackground**

```typescript
// packages/core/src/jobs/execute-job.ts
import type { PluginContext } from "../types.js";
import type { Job } from "../storage/interfaces.js";
import type { EventBuffer } from "./event-buffer.js";
import { runAgent } from "../agents/run-agent.js";

export interface JobExecutionContext {
  ctx: PluginContext;
  job: Job;
  eventBuffer: EventBuffer;
  abortController: AbortController;
}

/**
 * Execute an agent in the background, detached from the HTTP request lifecycle.
 * Updates the JobStore with status/result as execution progresses.
 * Buffers SSE events for reconnectable streaming.
 */
export async function executeJobInBackground(
  execCtx: JobExecutionContext,
): Promise<void> {
  const { ctx, job, eventBuffer, abortController } = execCtx;
  const startTime = performance.now();

  try {
    // Update status to running
    await ctx.storage.jobs.update(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    ctx.hooks?.emit("job:start", {
      jobId: job.id,
      agentName: job.agentName,
      input: job.input,
      conversationId: job.conversationId,
      scopeId: job.scopeId,
      timestamp: new Date().toISOString(),
    });

    // Look up agent
    const agent = ctx.agents.get(job.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${job.agentName}`);
    }

    // Build config and run
    const tools = agent.tools ?? ctx.tools.resolveTools(agent.toolNames);
    const system = await ctx.agents.getResolvedPrompt(job.agentName);

    const result = await runAgent(
      ctx,
      { system, tools, agentName: job.agentName },
      job.input,
      undefined,
      ctx.defaultMaxSteps,
    );

    const duration = performance.now() - startTime;

    // Update job with result
    await ctx.storage.jobs.update(job.id, {
      status: "completed",
      result: result.response,
      usage: result.usage,
      toolsUsed: result.toolsUsed,
      completedAt: new Date().toISOString(),
    });

    ctx.hooks?.emit("job:end", {
      jobId: job.id,
      agentName: job.agentName,
      output: result.response,
      duration,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      timestamp: new Date().toISOString(),
    });

    // Buffer the done event
    eventBuffer.push(job.id, {
      id: String(Date.now()),
      event: "done",
      data: JSON.stringify({
        status: "completed",
        result: result.response,
        usage: result.usage,
        toolsUsed: result.toolsUsed,
      }),
    });
  } catch (err: any) {
    if (abortController.signal.aborted) {
      await ctx.storage.jobs.update(job.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      ctx.hooks?.emit("job:cancelled", {
        jobId: job.id,
        agentName: job.agentName,
        duration: performance.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } else {
      await ctx.storage.jobs.update(job.id, {
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });

      ctx.hooks?.emit("agent:error", {
        agentName: job.agentName,
        input: job.input,
        error: err.message,
        duration: performance.now() - startTime,
        conversationId: job.conversationId,
        scopeId: job.scopeId,
        jobId: job.id,
        timestamp: new Date().toISOString(),
      });

      eventBuffer.push(job.id, {
        id: String(Date.now()),
        event: "error",
        data: JSON.stringify({ error: err.message }),
      });
    }
  }
}
```

**Step 5: Create index.ts**

```typescript
// packages/core/src/jobs/index.ts
export { executeJobInBackground, type JobExecutionContext } from "./execute-job.js";
export { createEventBuffer, type EventBuffer, type BufferedEvent } from "./event-buffer.js";
```

**Step 6: Export from core index**

In `packages/core/src/index.ts`:
```typescript
// Jobs
export { executeJobInBackground, type JobExecutionContext } from "./jobs/index.js";
export { createEventBuffer, type EventBuffer, type BufferedEvent } from "./jobs/index.js";
```

**Step 7: Run tests**

Run: `bun test packages/core/src/jobs/event-buffer.test.ts`
Expected: All 5 tests PASS

**Step 8: Commit**

```bash
git add packages/core/src/jobs/
git commit -m "feat(core): add background job execution and SSE event buffer"
```

---

### Task 10: Job Routes (Hono Adapter)

**Files:**
- Create: `packages/adapters/hono/src/routes/jobs/jobs.routes.ts`
- Create: `packages/adapters/hono/src/routes/jobs/jobs.handlers.ts`
- Modify: `packages/adapters/hono/src/plugin.ts`

**Step 1: Create job handlers**

Follow the pattern from `packages/adapters/hono/src/routes/crons/crons.handlers.ts`:

```typescript
// packages/adapters/hono/src/routes/jobs/jobs.handlers.ts
import type { Context } from "hono";
import type { PluginContext } from "@kitnai/core";
import type { EventBuffer } from "@kitnai/core";
import { createSSEStream } from "@kitnai/core";

export function createJobHandlers(ctx: PluginContext, eventBuffer: EventBuffer) {
  const store = ctx.storage.jobs;

  return {
    // GET /jobs
    async handleList(c: Context) {
      const scopeId = c.req.header("x-scope-id");
      const jobs = await store.list(scopeId);
      return c.json(jobs);
    },

    // GET /jobs/:id
    async handleGet(c: Context) {
      const { id } = c.req.param();
      const scopeId = c.req.header("x-scope-id");
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: "Job not found" }, 404);
      return c.json(job);
    },

    // GET /jobs/:id/stream — reconnectable SSE
    async handleStream(c: Context) {
      const { id } = c.req.param();
      const scopeId = c.req.header("x-scope-id");
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: "Job not found" }, 404);

      // If job is already done, replay buffered events
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        const events = eventBuffer.replay(id);
        if (events.length === 0) {
          // No buffered events — return job result as JSON
          return c.json(job);
        }

        return createSSEStream(async (writer) => {
          for (const event of events) {
            await writer.writeSSE(event);
          }
        });
      }

      // Job is still running — replay buffered events + stream live
      return createSSEStream(async (writer) => {
        // Replay buffered events first
        const buffered = eventBuffer.replay(id);
        for (const event of buffered) {
          await writer.writeSSE(event);
        }

        // Listen for new events
        await new Promise<void>((resolve) => {
          const unsub = eventBuffer.addListener(id, async (event) => {
            await writer.writeSSE(event);
            if (event.event === "done" || event.event === "error") {
              unsub();
              resolve();
            }
          });
        });
      });
    },

    // POST /jobs/:id/cancel
    async handleCancel(c: Context) {
      const { id } = c.req.param();
      const scopeId = c.req.header("x-scope-id");
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: "Job not found" }, 404);
      if (job.status !== "queued" && job.status !== "running") {
        return c.json({ error: "Job is not running" }, 400);
      }

      // The abort controller is managed by the execution context
      // We update the status; the execution loop checks for cancellation
      await store.update(id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      return c.json({ success: true });
    },

    // DELETE /jobs/:id
    async handleDelete(c: Context) {
      const { id } = c.req.param();
      const scopeId = c.req.header("x-scope-id");
      const deleted = await store.delete(id, scopeId);
      if (!deleted) return c.json({ error: "Job not found" }, 404);
      eventBuffer.cleanup(id);
      return c.json({ success: true });
    },
  };
}
```

**Step 2: Create job routes**

```typescript
// packages/adapters/hono/src/routes/jobs/jobs.routes.ts
import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import type { EventBuffer } from "@kitnai/core";
import { createJobHandlers } from "./jobs.handlers.js";

export function createJobRoutes(ctx: PluginContext, eventBuffer: EventBuffer) {
  const router = new Hono();
  const handlers = createJobHandlers(ctx, eventBuffer);

  router.get("/", handlers.handleList);
  router.get("/:id", handlers.handleGet);
  router.get("/:id/stream", handlers.handleStream);
  router.post("/:id/cancel", handlers.handleCancel);
  router.delete("/:id", handlers.handleDelete);

  return router;
}
```

**Step 3: Mount job routes in plugin.ts**

In `packages/adapters/hono/src/plugin.ts`:
- Import `createJobRoutes` from `./routes/jobs/jobs.routes.js`
- Import `createEventBuffer` from `@kitnai/core`
- Create a shared `EventBuffer` instance in `createAIPlugin()`:
  ```typescript
  const eventBuffer = createEventBuffer();
  ```
- Mount routes:
  ```typescript
  app.route("/jobs", createJobRoutes(ctx, eventBuffer));
  ```
- Store `eventBuffer` on the plugin instance so the async execution path (Task 11) can access it

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/adapters/hono/src/routes/jobs/ packages/adapters/hono/src/plugin.ts
git commit -m "feat(hono): add job CRUD, streaming, and cancellation routes"
```

---

### Task 11: Async Execution Path in Handler Factories

**Files:**
- Modify: `packages/core/src/registry/handler-factories.ts`
- Modify: `packages/adapters/hono/src/routes/agents/agents.handlers.ts` (or wherever the async query param is accessible)

This is the key integration: when `?async=true` is passed, the handler creates a Job, spawns background execution, and returns 202 immediately.

**Step 1: Add async path to the agent handler**

The exact integration point depends on how the Hono adapter passes query params to handler factories. The cleanest approach is to check in the Hono route handler (agents.handlers.ts) before calling the handler factory:

```typescript
// In the agent route handler (agents.handlers.ts or agents.routes.ts):
if (c.req.query("async") === "true") {
  const job = await ctx.storage.jobs.create({
    agentName,
    input: message,
    conversationId,
    scopeId,
    status: "queued",
  });

  const abortController = new AbortController();
  const execution = executeJobInBackground({
    ctx,
    job,
    eventBuffer,
    abortController,
  });

  // Keep execution alive on serverless
  ctx.config.waitUntil?.(execution);

  return c.json({ jobId: job.id }, 202);
}

// else: existing synchronous path (unchanged)
```

**Step 2: Thread eventBuffer to agent handlers**

The `eventBuffer` created in `plugin.ts` needs to be accessible in the agent route handlers. Options:
- Pass it through the route factory: `createAgentRoutes(ctx, eventBuffer)`
- Or attach it to `PluginContext` (simpler but slightly broader scope)

The cleaner approach is to add it as an optional field on `PluginContext` since it's a core concern:
```typescript
// In types.ts, add to PluginContext:
eventBuffer?: EventBuffer;
```

Then set it during plugin creation in `plugin.ts`.

**Step 3: Run typecheck and existing tests**

Run: `bun run typecheck && bun run --cwd packages/core test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/registry/handler-factories.ts packages/adapters/hono/src/routes/agents/ packages/adapters/hono/src/plugin.ts
git commit -m "feat(core): add opt-in async execution path (?async=true) for agent requests"
```

---

### Task 12: Job Routes (Elysia Adapter)

**Files:**
- Create: `packages/adapters/elysia/src/routes/jobs.ts`
- Modify: `packages/adapters/elysia/src/plugin.ts` (if it exists, otherwise the main entry point)

**Step 1: Implement Elysia job routes**

Follow the pattern from `packages/adapters/elysia/src/routes/crons.ts`:

```typescript
// packages/adapters/elysia/src/routes/jobs.ts
import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";

export function createJobRoutes(ctx: PluginContext) {
  const store = ctx.storage.jobs;

  return new Elysia({ prefix: "/jobs" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"];
      return store.list(scopeId);
    })
    .get("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"];
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: "Job not found" });
      return job;
    })
    .post("/:id/cancel", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"];
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: "Job not found" });
      if (job.status !== "queued" && job.status !== "running") {
        return status(400, { error: "Job is not running" });
      }
      await store.update(params.id, { status: "cancelled", completedAt: new Date().toISOString() });
      return { success: true };
    })
    .delete("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"];
      const deleted = await store.delete(params.id, scopeId);
      if (!deleted) return status(404, { error: "Job not found" });
      return { success: true };
    });
}
```

Note: Reconnectable SSE (`/jobs/:id/stream`) may not be straightforward in Elysia. Implement the CRUD routes first, mark streaming as a TODO if Elysia's SSE handling differs significantly from Hono.

**Step 2: Mount in Elysia plugin**

Add `createJobRoutes(ctx)` to the Elysia plugin's route mounting.

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/adapters/elysia/src/routes/jobs.ts packages/adapters/elysia/src/
git commit -m "feat(elysia): add job routes"
```

---

### Task 13: Job Routes (Hono-OpenAPI Adapter)

**Files:**
- Create: `packages/adapters/hono-openapi/src/routes/jobs.ts`
- Modify: `packages/adapters/hono-openapi/src/plugin.ts`

**Step 1: Implement OpenAPI job routes**

Follow the pattern from other hono-openapi routes. Use `@hono/zod-openapi` for schema definitions:

```typescript
// packages/adapters/hono-openapi/src/routes/jobs.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";

const JobSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  input: z.string(),
  conversationId: z.string(),
  scopeId: z.string().optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  result: z.string().optional(),
  error: z.string().optional(),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }).optional(),
  toolsUsed: z.array(z.string()).optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

// Define routes with OpenAPI schemas, following the same pattern as crons
// GET /jobs, GET /jobs/:id, POST /jobs/:id/cancel, DELETE /jobs/:id
```

**Step 2: Mount in hono-openapi plugin**

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/adapters/hono-openapi/src/routes/jobs.ts packages/adapters/hono-openapi/src/
git commit -m "feat(hono-openapi): add OpenAPI job routes with zod schemas"
```

---

### Task 14: Integration Test

**Files:**
- Create: `packages/core/src/hooks/integration.test.ts`

**Step 1: Write integration test**

Test that the full lifecycle works: create hooks → emit events → verify handlers called. This tests the wiring, not individual components:

```typescript
// packages/core/src/hooks/integration.test.ts
import { describe, test, expect, mock } from "bun:test";
import { createLifecycleHooks } from "./lifecycle-hooks.js";
import { createEventBuffer } from "../jobs/event-buffer.js";
import { createMemoryStorage } from "../storage/in-memory/index.js";

describe("Lifecycle Hooks Integration", () => {
  test("hooks + event buffer work together", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const buffer = createEventBuffer();
    const handler = mock(() => {});

    hooks.on("agent:end", (event) => {
      handler(event);
      buffer.push("job_1", {
        id: "1",
        event: "agent:end",
        data: JSON.stringify(event),
      });
    });

    hooks.emit("agent:end", {
      agentName: "test",
      input: "hi",
      output: "hello",
      toolsUsed: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      duration: 100,
      conversationId: "conv_1",
      timestamp: new Date().toISOString(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const buffered = buffer.replay("job_1");
    expect(buffered).toHaveLength(1);
    expect(JSON.parse(buffered[0].data).agentName).toBe("test");
  });

  test("memory storage JobStore works end-to-end", async () => {
    const storage = createMemoryStorage();

    const job = await storage.jobs.create({
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv_1",
      status: "queued",
    });

    const updated = await storage.jobs.update(job.id, {
      status: "completed",
      result: "done",
    });

    expect(updated.status).toBe("completed");

    const listed = await storage.jobs.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("completed");
  });
});
```

**Step 2: Run integration tests**

Run: `bun test packages/core/src/hooks/integration.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `bun run test`
Expected: All existing tests PASS, new tests PASS

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/hooks/integration.test.ts
git commit -m "test(core): add lifecycle hooks and jobs integration tests"
```

---

## Phase 3: CLI Updates (if needed)

### Task 15: Add kitn:job Component Type to CLI

**Only needed if we decide to distribute job-related registry components.** The current design has loggers and webhook forwarders as `kitn:tool` type components, which already works. Skip this task unless we introduce a new component type for job-related add-ons.

If needed, follow the same pattern as the `kitn:cron` type addition documented in the crons design doc (`docs/plans/2026-02-28-crons-design.md`, CLI Updates section). The files to update are:

1. `packages/cli/src/registry/schema.ts` — Add to `componentType` enum and `typeToDir`
2. `packages/cli/src/utils/type-aliases.ts` — Add aliases
3. `packages/cli/src/commands/create.ts` — Add scaffold template
4. `packages/cli/src/installers/import-rewriter.ts` — Add to `KNOWN_TYPES`
5. `registry/scripts/build-registry.ts` — Add to type map
6. `registry/scripts/validate-registry.ts` — Add to type map

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| **1: Lifecycle Hooks** | Tasks 1-5 | `LifecycleHookEmitter` with summary + trace levels, integrated into plugin, emitting from all execution paths |
| **2: Background Execution** | Tasks 6-13 | `JobStore` (file + memory), async execution path, reconnectable SSE, job cancellation, routes in all 3 adapters |
| **3: CLI** | Task 15 | Component type for job-related registry add-ons (if needed) |

**Total new files:** ~15
**Total modified files:** ~12
**Test files:** ~5

Registry add-ons (console logger, file logger, webhook forwarder, webhook manager) are separate follow-up work and will be planned in a separate document once the core foundation is in place.
