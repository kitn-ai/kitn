# Lifecycle Hooks

Lifecycle hooks provide structured observability into agent execution. Subscribe to events at the plugin level to monitor, log, or forward execution data to external systems.

## Configuration

Enable hooks by adding a `hooks` config to your plugin:

```typescript
import { createAIPlugin } from "@kitn/adapters/hono";

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  hooks: {
    level: "summary", // "summary" or "trace"
  },
});
```

- **`summary`** — Emits completion events: agent started, agent finished, agent errored, cron executed, job lifecycle. Low overhead, suitable for production.
- **`trace`** — Adds detailed events: individual tool calls with inputs/outputs, delegation between agents, LLM API calls. Use for debugging.

## Subscribing to Events

Use `plugin.on()` to subscribe to events:

```typescript
// Specific event
const unsub = plugin.on("agent:end", (event) => {
  console.log(`${event.agentName} completed in ${event.duration}ms`);
  console.log(`Tokens: ${event.usage.totalTokens}`);
});

// All events (wildcard)
plugin.on("*", (event) => {
  sendToDatadog({ type: event.type, ...event });
});

// Unsubscribe when done
unsub();
```

## Summary Events

These fire at both `summary` and `trace` levels.

### `agent:start`

Fires when an agent begins execution.

```typescript
plugin.on("agent:start", (event) => {
  // event.agentName: string
  // event.input: string
  // event.conversationId: string
  // event.scopeId?: string
  // event.jobId?: string       (present if async execution)
  // event.timestamp: number    (epoch ms)
});
```

### `agent:end`

Fires when an agent completes successfully.

```typescript
plugin.on("agent:end", (event) => {
  // event.agentName: string
  // event.input: string
  // event.output: string
  // event.toolsUsed: string[]
  // event.usage: { promptTokens, completionTokens, totalTokens }
  // event.duration: number     (milliseconds)
  // event.conversationId: string
  // event.scopeId?: string
  // event.jobId?: string
  // event.timestamp: number
});
```

### `agent:error`

Fires when an agent execution fails.

```typescript
plugin.on("agent:error", (event) => {
  // event.agentName: string
  // event.input: string
  // event.error: unknown       (typically Error instance or string)
  // event.duration: number
  // event.conversationId: string
  // event.scopeId?: string
  // event.jobId?: string
  // event.timestamp: number
});
```

### `job:start` / `job:end` / `job:cancelled`

Fire during async job execution (see [Background Jobs](./background-jobs.md)).

### `cron:executed`

Fires after a cron job runs.

```typescript
plugin.on("cron:executed", (event) => {
  // event.cronId: string
  // event.agentName: string
  // event.executionId: string
  // event.status: "completed" | "failed"
  // event.duration: number
  // event.timestamp: number
});
```

## Trace Events

These only fire when `level: "trace"` is configured.

### `tool:execute`

Fires after each tool call completes.

```typescript
plugin.on("tool:execute", (event) => {
  // event.agentName: string
  // event.toolName: string
  // event.input: Record<string, unknown>
  // event.output: unknown
  // event.duration: number
  // event.conversationId: string
  // event.timestamp: number
});
```

### `delegate:start` / `delegate:end`

Fire when an orchestrator delegates to a sub-agent.

```typescript
plugin.on("delegate:start", (event) => {
  // event.parentAgent: string
  // event.childAgent: string
  // event.input: string
  // event.conversationId: string
  // event.timestamp: number
});

plugin.on("delegate:end", (event) => {
  // event.parentAgent: string
  // event.childAgent: string
  // event.output: string
  // event.duration: number
  // event.conversationId: string
  // event.timestamp: number
});
```

### `model:call`

Fires after each LLM API call.

```typescript
plugin.on("model:call", (event) => {
  // event.agentName: string
  // event.model: string
  // event.promptTokens: number
  // event.completionTokens: number
  // event.duration: number
  // event.conversationId: string
  // event.timestamp: number
});
```

## Common Patterns

### Error alerting

```typescript
plugin.on("agent:error", (event) => {
  alertOpsTeam(event.agentName, event.error);
});
```

### Cost tracking

```typescript
plugin.on("agent:end", (event) => {
  db.insert("usage_log", {
    agent: event.agentName,
    tokens: event.usage.totalTokens,
    timestamp: new Date(event.timestamp),
  });
});
```

### Forwarding to an external service

```typescript
plugin.on("*", (event) => {
  fetch("https://logs.example.com/ingest", {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "Content-Type": "application/json" },
  }).catch(() => {}); // fire-and-forget
});
```

## Design Notes

- Hook handlers are fire-and-forget. A slow or failing handler will never block agent execution.
- Handler errors are silently caught. Async handler rejections are also swallowed.
- Handlers receive plain data objects (copies), not references to internal state.
- When hooks are not configured, all `emit()` calls are no-ops with zero overhead.
