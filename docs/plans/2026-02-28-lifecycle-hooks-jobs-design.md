# Lifecycle Hooks, Background Jobs & Observability Design

## Summary

Add three interconnected capabilities to kitn, built on a unified event foundation:

1. **Lifecycle Hooks** (`@kitnai/core`) — A plugin-level subscription API for structured execution events. Enables observability, logging, webhooks, and future features (evals, feedback) without opinionated storage in core.
2. **Background Execution** (`@kitnai/core`) — Opt-in async mode for agent calls. `POST /agents/:name?async=true` returns a `jobId` immediately. Includes reconnectable SSE, job cancellation, and serverless compatibility via `waitUntil`.
3. **Registry Add-Ons** (registry components) — Plug-and-play consumers of lifecycle hooks: console logger, file logger, webhook forwarder, webhook manager with CRUD + retry + delivery tracking.

## Design Principles

- **Core provides mechanism, add-ons provide policy.** Core emits structured events and tracks async jobs. Where those events go (Datadog, file, webhook, Postgres) is the user's choice via add-ons.
- **Opt-in complexity.** Default behavior is unchanged. Async mode, trace-level detail, and webhook management are all opt-in.
- **Mix-and-match storage.** `JobStore` follows the same pattern as every other sub-store in `StorageProvider` — users choose file, memory, Postgres, Redis, D1, whatever.
- **Serverless-compatible.** Background execution works on edge/serverless platforms via a `waitUntil` config hook.

## Decision: Events, Not Stores, for Observability

Logging and audit trail data is NOT stored in a core sub-store. Instead, core emits structured lifecycle events and users decide where they go. This avoids being opinionated about log storage format, retention, querying. Registry add-ons (file logger, Postgres logger, Datadog forwarder) handle persistence.

The only new sub-store is `JobStore` — because async job tracking requires queryable state (status, result) that the user polls via API. That's execution state, not logs.

## Decision: Lifecycle Hooks Are Separate from AgentEventBus

The existing `AgentEventBus` is low-level — per-chunk SSE events (`text:delta`, `tool:call`) scoped to a single agent execution for real-time streaming. Lifecycle hooks are a higher-level abstraction:

| Concern | AgentEventBus | Lifecycle Hooks |
|---------|--------------|-----------------|
| Scope | Single agent execution | Plugin-wide |
| Granularity | Per-token, per-chunk | Per-completion |
| Consumer | SSE stream writer | External systems, add-ons |
| Propagation | AsyncLocalStorage (DelegationContext) | Direct subscription on plugin |
| Purpose | Real-time client streaming | Observability, integration, automation |

Lifecycle hooks fire at agent execution boundaries (start/end), not on every token. They carry full context (agent name, input, output, tools used, duration, token usage) in a single event.

## Lifecycle Hooks

### Event Types

**Summary level (always emitted when hooks are enabled):**

```typescript
interface HookEvents {
  // Agent execution lifecycle
  "agent:start": {
    agentName: string;
    input: string;
    conversationId: string;
    scopeId?: string;
    jobId?: string;         // Present if async execution
    timestamp: string;
  };

  "agent:end": {
    agentName: string;
    input: string;
    output: string;
    toolsUsed: string[];
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    duration: number;       // milliseconds
    conversationId: string;
    scopeId?: string;
    jobId?: string;
    timestamp: string;
  };

  "agent:error": {
    agentName: string;
    input: string;
    error: string;
    duration: number;
    conversationId: string;
    scopeId?: string;
    jobId?: string;
    timestamp: string;
  };

  // Job lifecycle (async execution only)
  "job:start": {
    jobId: string;
    agentName: string;
    input: string;
    conversationId: string;
    scopeId?: string;
    timestamp: string;
  };

  "job:end": {
    jobId: string;
    agentName: string;
    output: string;
    duration: number;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    timestamp: string;
  };

  "job:cancelled": {
    jobId: string;
    agentName: string;
    duration: number;
    timestamp: string;
  };

  // Cron lifecycle (emitted from executeCronJob)
  "cron:executed": {
    cronId: string;
    agentName: string;
    executionId: string;
    status: "completed" | "failed";
    duration: number;
    timestamp: string;
  };
}
```

**Trace level (opt-in, for debugging):**

```typescript
interface TraceHookEvents {
  "tool:execute": {
    agentName: string;
    toolName: string;
    input: Record<string, unknown>;
    output: unknown;
    duration: number;
    conversationId: string;
    timestamp: string;
  };

  "delegate:start": {
    parentAgent: string;
    childAgent: string;
    input: string;
    conversationId: string;
    timestamp: string;
  };

  "delegate:end": {
    parentAgent: string;
    childAgent: string;
    output: string;
    duration: number;
    conversationId: string;
    timestamp: string;
  };

  "model:call": {
    agentName: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    duration: number;
    conversationId: string;
    timestamp: string;
  };
}
```

### Subscription API

```typescript
const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  hooks: {
    level: "summary",  // "summary" | "trace". Default: "summary"
  },
});

// Subscribe to a specific event
const unsub = plugin.on("agent:end", (event) => {
  console.log(`${event.agentName} completed in ${event.duration}ms`);
});

// Subscribe to all events (wildcard)
plugin.on("*", (event) => {
  sendToDatadog(event);
});

// Unsubscribe
unsub();
```

### Implementation

**LifecycleHookEmitter** — new class in `packages/core/src/hooks/`:

```typescript
// packages/core/src/hooks/lifecycle-hooks.ts

interface LifecycleHookEmitter {
  on<E extends keyof AllHookEvents>(event: E, handler: (data: AllHookEvents[E]) => void): () => void;
  on(event: "*", handler: (data: { type: string } & Record<string, unknown>) => void): () => void;
  emit<E extends keyof AllHookEvents>(event: E, data: AllHookEvents[E]): void;
}
```

- Handlers are called asynchronously (fire-and-forget) — a slow handler does not block agent execution
- Handlers receive plain objects (copies), not references to internal state
- Errors in handlers are caught and logged (do not propagate to agent execution)
- The `*` wildcard receives all events with a `type` field added

**Where hooks fire:**

| Hook | Emission point |
|------|---------------|
| `agent:start` / `agent:end` / `agent:error` | `makeRegistryStreamHandler()`, `makeRegistryJsonHandler()` in handler-factories.ts |
| `job:start` / `job:end` / `job:cancelled` | New async execution path in handler-factories.ts |
| `cron:executed` | `executeCronJob()` in execute-cron.ts |
| `tool:execute` | Tool execution in run-agent.ts / stream-helpers.ts (trace level only) |
| `delegate:start` / `delegate:end` | Delegation handling in orchestrator (trace level only) |
| `model:call` | `streamText()` / `generateText()` wrappers (trace level only) |

### Plugin Integration

`LifecycleHookEmitter` is added to `PluginContext`:

```typescript
interface PluginContext {
  // ... existing fields
  hooks?: LifecycleHookEmitter;  // Present when hooks config is provided
}
```

The `plugin.on()` convenience method delegates to `ctx.hooks.on()`. When `hooks` config is omitted, no events are emitted (zero overhead).

## Background Execution

### Job Data Model

```typescript
interface Job {
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
```

### JobStore — 9th Sub-Store in StorageProvider

```typescript
interface JobStore {
  create(job: Omit<Job, "id" | "createdAt">): Promise<Job>;
  get(id: string, scopeId?: string): Promise<Job | null>;
  list(scopeId?: string): Promise<Job[]>;
  update(id: string, updates: Partial<Job>): Promise<Job>;
  delete(id: string, scopeId?: string): Promise<boolean>;
}
```

Added to `StorageProvider`:

```typescript
interface StorageProvider {
  // ... existing 8 sub-stores
  jobs: JobStore;
}
```

Two built-in implementations following existing patterns:

**File-based** (`createFileStorage`):
- Directory: `{dataDir}/jobs/`
- One JSON file per job: `{id}.json`
- Uses `withLock()` for write serialization
- Supports `scopeId` via `scopeDir()` pattern

**In-memory** (`createMemoryStorage`):
- `Map<string, Job>` for jobs
- Scope-aware key strategy matching existing stores

### Async Execution Flow

```
Client                          Server
  |                               |
  | POST /agents/:name?async=true |
  |------------------------------>|
  |                               | 1. Create Job (status: "queued")
  |                               | 2. Emit "job:start" hook
  |                               | 3. Spawn execution (detached from request)
  |    { jobId: "job_abc123" }    |
  |<------------------------------|  (HTTP 202 Accepted)
  |                               |
  |                               | 4. Update Job (status: "running")
  |                               | 5. Run agent (not tied to client abort)
  |                               | 6. Buffer SSE events in memory
  |                               |
  | GET /jobs/job_abc123          |
  |------------------------------>|
  |  { status: "running", ... }   |
  |<------------------------------|
  |                               |
  |                               | 7. Agent completes
  |                               | 8. Update Job (status: "completed", result)
  |                               | 9. Emit "job:end" + "agent:end" hooks
  |                               |
  | GET /jobs/job_abc123          |
  |------------------------------>|
  | { status: "completed",        |
  |   result: "...", usage: {} }  |
  |<------------------------------|
```

### Reconnectable SSE

```
Client A (original)              Server                    Client B (reconnect)
  |                                |                          |
  | POST /agents/:name?async=true  |                          |
  |------------------------------->|                          |
  |    { jobId: "job_abc123" }     |                          |
  |<-------------------------------|                          |
  |                                | (agent running,          |
  | (client refreshes/disconnects) |  buffering SSE events)   |
  x                                |                          |
                                   |  GET /jobs/job_abc123/stream
                                   |<-------------------------|
                                   | 1. Replay buffered events|
                                   |------------------------->|
                                   | 2. Continue live stream   |
                                   |------------------------->|
                                   | 3. "done" event          |
                                   |------------------------->|
```

**Event buffer:**
- In-memory only (not persisted to JobStore)
- Keyed by job ID
- Cleaned up when job completes + no active stream connections + a short grace period
- If server restarts mid-job, the buffer is lost — but the Job record in the store captures the final result
- The buffer exists for the live streaming experience, not as durable storage

### Job Cancellation

```
POST /jobs/:id/cancel
  → Sets abort signal for the running agent
  → Updates Job status to "cancelled"
  → Emits "job:cancelled" hook
  → Returns { success: true }
```

Uses the existing `cancelRequest()` / `registerRequest()` mechanism, extended to work with job IDs.

### Serverless / Edge Compatibility

On serverless platforms (Vercel, Cloudflare Workers), the runtime shuts down after the response is sent. Background execution requires the platform's `waitUntil` API:

```typescript
const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  waitUntil: (promise) => ctx.waitUntil(promise),  // Cloudflare / Vercel
});
```

**How it works:**
- On long-running servers: background execution runs in-process (default, no config needed)
- On serverless/edge: `waitUntil` extends the runtime to keep the agent running after the response is sent
- For jobs exceeding platform time limits: users need an external executor (registry add-on, same pattern as external cron schedulers)

When `waitUntil` is configured, the async execution path wraps the agent promise in `waitUntil()` to prevent the runtime from shutting it down.

### New API Endpoints

```
GET    /jobs              — List jobs (filterable by status, agentName)
GET    /jobs/:id          — Get job status and result
GET    /jobs/:id/stream   — Reconnect to SSE for a running job
POST   /jobs/:id/cancel   — Cancel a running job
DELETE /jobs/:id          — Delete a completed/failed/cancelled job record
```

Mounted in adapters: `app.route("/jobs", createJobRoutes(ctx))`

Same pattern applied to Hono, Hono-OpenAPI, and Elysia adapters.

### Changes to Existing Execution Path

The handler factories (`makeRegistryStreamHandler`, `makeRegistryJsonHandler`) gain a check:

```typescript
// Pseudocode
if (query.async === "true") {
  const job = await ctx.storage.jobs.create({ agentName, input, conversationId, status: "queued" });
  ctx.hooks?.emit("job:start", { jobId: job.id, agentName, input, ... });

  const execution = runAgentInBackground(ctx, job);
  ctx.config.waitUntil?.(execution);

  return c.json({ jobId: job.id }, 202);
}
// else: existing synchronous path (unchanged)
```

Synchronous execution is completely unaffected. No overhead unless `?async=true` is used.

## Registry Add-Ons

Four registry components that consume lifecycle hooks. Users install the ones they need.

### Console Logger — `kitn add tool console-logger`

**Location:** `registry/components/tools/console-logger/`

Subscribes to lifecycle hooks and prints structured, formatted logs to the console. Useful during development.

```typescript
// Usage:
import { createConsoleLogger } from "./console-logger.js";

createConsoleLogger(plugin, {
  events: ["agent:end", "agent:error", "tool:execute"],  // optional filter
  format: "pretty",  // "pretty" | "json"
});
```

**Output example (pretty):**
```
[agent] email-checker completed in 2340ms (1,247 tokens) — 3 tools used
[tool]  searchEmails called by email-checker (890ms)
[agent] summarizer failed: Rate limit exceeded (450ms)
```

### File Logger — `kitn add tool file-logger`

**Location:** `registry/components/tools/file-logger/`

Writes execution events as JSON lines to rotating log files.

```typescript
createFileLogger(plugin, {
  dir: "./logs",
  rotation: "daily",       // or { maxSize: "10mb" }
  events: ["agent:end"],   // optional filter
});
```

### Webhook Forwarder — `kitn add tool webhook-forwarder`

**Location:** `registry/components/tools/webhook-forwarder/`

Simple: subscribe to events, POST them to configured URLs. No management API — configure in code.

```typescript
createWebhookForwarder(plugin, {
  url: "https://my-app.com/hooks/agent-events",
  events: ["agent:end", "job:end", "cron:executed"],
  secret: process.env.WEBHOOK_SECRET,   // HMAC-SHA256 signing
  retry: { maxAttempts: 3, backoff: "exponential" },
});
```

**Webhook payload:**
```json
{
  "type": "agent:end",
  "timestamp": "2026-02-28T15:30:00Z",
  "data": {
    "agentName": "email-checker",
    "output": "Found 3 important emails...",
    "duration": 2340,
    "usage": { "totalTokens": 1247 }
  }
}
```

**Verification:** Recipients verify webhooks via HMAC-SHA256 signature in `X-Webhook-Signature` header.

### Webhook Manager — `kitn add tool webhook-manager`

**Location:** `registry/components/tools/webhook-manager/`

Rich webhook management with its own store, CRUD API, retry logic, and delivery tracking. For users who need runtime-configurable, multi-tenant webhook endpoints.

**Adds API routes:**
```
POST   /webhooks              — Register a webhook endpoint
GET    /webhooks               — List registered webhooks
PATCH  /webhooks/:id           — Update a webhook (change URL, events, enabled)
DELETE /webhooks/:id           — Remove a webhook
GET    /webhooks/:id/deliveries — View delivery history
```

**Webhook registration:**
```json
POST /webhooks
{
  "url": "https://slack.com/api/...",
  "events": ["agent:end", "cron:executed"],
  "secret": "whsec_...",
  "enabled": true
}
```

**Delivery tracking:**
- Each delivery attempt is recorded: timestamp, status code, response time, success/failure
- Failed deliveries retry with exponential backoff (configurable max attempts)
- Webhooks auto-disable after N consecutive failures (configurable)

**Storage:** Uses its own internal store (not added to `StorageProvider` — this is an add-on's concern). File-based by default, configurable.

## File Map

### Core changes:
```
packages/core/src/
  hooks/
    lifecycle-hooks.ts          — LifecycleHookEmitter class + event type definitions
    index.ts                    — re-exports
  jobs/
    job-store.ts                — Job interface (exported from storage/interfaces.ts)
    execute-job.ts              — Background execution logic (detach from request)
    event-buffer.ts             — In-memory SSE event buffer for reconnectable streams
    index.ts                    — re-exports
  storage/
    interfaces.ts               — add Job, JobStore to StorageProvider
    file-storage/
      index.ts                  — wire up job store in createFileStorage()
      job-store.ts              — file-based JobStore implementation
    in-memory/
      index.ts                  — wire up job store in createMemoryStorage()
      job-store.ts              — in-memory JobStore implementation
  types.ts                      — add hooks + waitUntil to PluginContext / CoreConfig
  index.ts                      — export new types
```

### Adapter changes:
```
packages/adapters/hono/src/
  routes/jobs/
    jobs.routes.ts              — createJobRoutes(ctx)
    jobs.handlers.ts            — createJobHandlers(ctx)
  routes/agents/
    agents.handlers.ts          — add async execution path check
  plugin.ts                     — mount job routes

packages/adapters/hono-openapi/src/
  routes/jobs.ts                — OpenAPI job routes

packages/adapters/elysia/src/
  routes/jobs.ts                — Elysia job routes
```

### Registry add-ons:
```
registry/components/tools/
  console-logger/
    manifest.json
    console-logger.ts
  file-logger/
    manifest.json
    file-logger.ts
  webhook-forwarder/
    manifest.json
    webhook-forwarder.ts
  webhook-manager/
    manifest.json
    webhook-manager.ts
    webhook-store.ts            — internal storage for registrations + deliveries
```

### Hook emission points (edits to existing files):
```
packages/core/src/
  registry/handler-factories.ts — emit agent:start/end/error + async path
  crons/execute-cron.ts         — emit cron:executed
  agents/run-agent.ts           — emit tool:execute (trace level)
  agents/orchestrator.ts        — emit delegate:start/end (trace level)
  streaming/stream-helpers.ts   — emit model:call (trace level)
```

## User Experience

### Basic observability (code-level):

```typescript
const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  hooks: { level: "summary" },
});

plugin.on("agent:end", (e) => {
  console.log(`${e.agentName}: ${e.duration}ms, ${e.usage.totalTokens} tokens`);
});

plugin.on("agent:error", (e) => {
  alertOpsTeam(e.agentName, e.error);
});
```

### Debugging with trace level:

```typescript
const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  hooks: { level: "trace" },
});

plugin.on("tool:execute", (e) => {
  console.log(`[${e.agentName}] ${e.toolName}(${JSON.stringify(e.input)}) → ${e.duration}ms`);
});

plugin.on("model:call", (e) => {
  console.log(`[${e.agentName}] LLM call: ${e.model}, ${e.promptTokens}+${e.completionTokens} tokens`);
});
```

### With add-ons:

```typescript
import { createConsoleLogger } from "./ai/tools/console-logger.js";
import { createWebhookForwarder } from "./ai/tools/webhook-forwarder.js";

createConsoleLogger(plugin, { format: "pretty" });

createWebhookForwarder(plugin, {
  url: "https://hooks.slack.com/...",
  events: ["agent:error", "cron:executed"],
  secret: process.env.WEBHOOK_SECRET,
});
```

### Async execution:

```typescript
// Fire and forget
const res = await fetch("/api/agents/email-checker?async=true", {
  method: "POST",
  body: JSON.stringify({ message: "Check my email" }),
});
const { jobId } = await res.json(); // HTTP 202

// Poll for result
const job = await fetch(`/api/jobs/${jobId}`).then(r => r.json());
// { status: "completed", result: "Found 3 emails...", usage: { ... } }

// Or reconnect to live stream
const stream = new EventSource(`/api/jobs/${jobId}/stream`);
stream.onmessage = (e) => console.log(e.data);
```

### Serverless (Cloudflare Workers):

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const plugin = createAIPlugin({
      model: (id) => openrouter(id ?? MODEL),
      storage: createD1Storage(env.DB),
      hooks: { level: "summary" },
      waitUntil: (p) => ctx.waitUntil(p),
    });

    plugin.on("agent:end", (e) => {
      // fires even after response is sent
    });

    return plugin.router.fetch(request);
  },
};
```

## Future Integration Points

The lifecycle hooks system is designed as the universal extension point for features beyond Tier 1:

- **Evals:** Subscribe to `agent:end`, evaluate the output quality, store eval scores
- **Feedback loop:** Thumbs up/down on messages → stored alongside the execution event → eval agent reviews low-scoring responses
- **Self-improvement:** An agent that subscribes to negative feedback events, analyzes patterns, and proposes prompt/tool adjustments
- **Agent versioning:** Track which prompt version produced which output (via hooks metadata)
- **Cost tracking:** Subscribe to `model:call` events, aggregate token usage per agent/user/period
- **Analytics dashboard:** Subscribe to `*`, aggregate into time-series metrics

All of these build on the hooks foundation without requiring core changes.
