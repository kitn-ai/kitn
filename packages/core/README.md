# @kitnai/core

Framework-agnostic AI agent engine -- orchestration, tools, storage, memory, events, voice, and more.

This is the heart of the kitn monorepo. It contains no HTTP types or framework bindings. Use it with an adapter like [`@kitn/adapters/hono`](../adapters/hono/) to expose agents over HTTP, or use the core APIs directly in any TypeScript runtime.

Published to npm as `@kitn/core`.

## Installation

```bash
npm install @kitn/core
# or
bun add @kitn/core
# or
pnpm add @kitn/core
```

### Peer dependencies

`@kitn/core` requires two peer dependencies:

| Package | Version |
|---------|---------|
| `ai` (Vercel AI SDK) | `^6.0.91` |
| `zod` | `^4.3.6` |

Install them alongside the core package:

```bash
npm install ai zod
```

## Modules

### Agents

Register, resolve, and execute AI agents. Each agent has a name, description, system prompt, tools, and optional guard.

- **`AgentRegistry`** -- in-memory registry for agent registrations. Supports prompt overrides persisted via `PromptStore`.
- **`runAgent()`** -- low-level function that calls an agent with tools via `generateText()`. Handles retries, tool call/result events, and clarification extraction.
- **`executeTask()`** -- higher-level function used by the orchestrator. Resolves the agent, enforces delegation depth/cycle checks, invokes guards, injects skills, and emits delegation lifecycle events.

```ts
import { AgentRegistry } from "@kitn/core";

const agents = new AgentRegistry();
agents.register({
  name: "weather",
  description: "Answers weather questions",
  defaultSystem: "You are a weather assistant.",
  defaultFormat: "sse",
  toolNames: ["getWeather"],
  tools: { getWeather: weatherTool },
});
```

#### Guards

Agents can define a `guard` function that runs before execution. Guards receive the user query, agent name, and conversation context. Return `{ allowed: false, reason }` to block execution.

```ts
agents.register({
  name: "guarded-agent",
  // ...
  guard: async (query, agent, context) => {
    if (context?.hasHistory) return { allowed: true };
    if (isOffTopic(query)) return { allowed: false, reason: "Off-topic" };
    return { allowed: true };
  },
});
```

### Tools

Register tools with Zod input schemas for use by agents and for direct execution.

- **`ToolRegistry`** -- in-memory registry. Supports `register()`, `get()`, `list()`, and `execute()` (for direct tool invocation outside an agent).
- **`ToolRegistration`** -- includes `name`, `description`, `inputSchema`, the AI SDK `tool` object, an optional `directExecute` function, `category`, and structured `examples`.

```ts
import { ToolRegistry } from "@kitn/core";

const tools = new ToolRegistry();
tools.register({
  name: "calculator",
  description: "Evaluate math expressions",
  inputSchema: z.object({ expression: z.string() }),
  tool: calculatorTool,
  directExecute: async (input) => eval(input.expression),
});

// Direct execution (no agent needed)
const result = await tools.execute("calculator", { expression: "2 + 2" });
```

### Orchestration

Multi-agent coordination with routing, parallel task decomposition, and result synthesis.

- **`createOrchestratorAgent()`** -- factory that registers an orchestrator agent with `routeToAgent` and `createTask` tools. Orchestrators route queries to specialist agents or decompose them into parallel sub-tasks.
- **`DEFAULT_ORCHESTRATOR_PROMPT`** -- the built-in system prompt for orchestrators.

The orchestrator supports:
- **Direct routing** -- single-agent delegation via `routeToAgent`
- **Parallel tasks** -- multi-agent fan-out via `createTask`, followed by LLM-powered synthesis
- **Plan mode** -- returns a task plan for user approval before execution
- **Skill injection** -- attaches behavioral skills to delegated agents

```ts
import { createOrchestratorAgent } from "@kitn/core";

createOrchestratorAgent(ctx, {
  name: "orchestrator",
  agents: ["weather", "calculator"],  // restrict routing to these agents
  autonomous: true,                    // execute immediately (no approval step)
});
```

### Storage

Modular persistence via the `StorageProvider` interface, which aggregates 8 independent sub-stores:

| Sub-store | Interface | Purpose |
|-----------|-----------|---------|
| `conversations` | `ConversationStore` | Multi-turn conversation history |
| `memory` | `MemoryStore` | Namespaced key-value memory |
| `skills` | `SkillStore` | Behavioral skill definitions (markdown + frontmatter) |
| `tasks` | `TaskStore` | Simple todo/task tracking |
| `prompts` | `PromptStore` | Agent system prompt overrides |
| `commands` | `CommandStore` | Named command configurations |
| `crons` | `CronStore` | Scheduled job definitions and execution history |
| `jobs` | `JobStore` | Background job records |

Each sub-store is an independent interface. You can mix and match implementations -- back conversations with Postgres, memory with Redis, and audio with S3.

#### Built-in implementations

- **`createFileStorage()`** -- file-based JSON storage. Writes to a configurable directory.
- **`createMemoryStorage()`** -- ephemeral in-memory storage. Default when no storage is configured.

```ts
import { createFileStorage, createMemoryStorage } from "@kitn/core";

// File-based (persistent)
const storage = createFileStorage({ dir: "./data" });

// In-memory (ephemeral)
const storage = createMemoryStorage();

// Custom mix-and-match
const storage: StorageProvider = {
  conversations: new PostgresConversationStore(db),
  memory: new RedisMemoryStore(redis),
  skills: createFileStorage({ dir: "./skills" }).skills,
  // ...
};
```

### Memory

Namespaced key-value memory that agents use to persist facts, preferences, and intermediate results across conversations.

- **`createMemoryTool()`** -- creates the built-in `_memory` tool with `get`, `set`, `list`, and `delete` actions. Bound to a `MemoryStore` and a default namespace (typically the agent name).
- **`getDefaultMemoryStore()` / `setDefaultMemoryStore()`** -- manage the singleton default memory store.
- **`createInMemoryMemoryStore()`** -- standalone in-memory `MemoryStore` implementation.

The memory tool is automatically injected into agents during task execution unless `disableMemoryTool: true` is set on the agent registration.

### Skills

Behavioral instructions stored as markdown documents with YAML frontmatter. Skills are injected into agent system prompts to modify behavior.

Each skill has:
- **`name`**, **`description`**, **`tags`** -- metadata
- **`phase`** -- when to inject: `"query"` (before execution), `"response"` (during synthesis), or `"both"`
- **`content`** -- the instruction text

Skills are managed through the `SkillStore` interface and can be attached when routing or creating tasks.

### Conversations

Multi-turn conversation management with automatic compaction.

- **`ConversationStore`** -- CRUD operations for conversations. Supports `get`, `list`, `create`, `append`, `delete`, and `clear`. All methods accept an optional `scopeId` for multi-tenant isolation.
- **`compactConversation()`** -- summarizes older messages with an LLM call when conversations exceed a token threshold. Uses token-based budgeting to determine what to preserve vs. summarize.
- **`needsCompaction()`** -- checks if a conversation exceeds the configured token limit.
- **`loadConversationWithCompaction()`** -- loads conversation history, auto-compacting if needed.

```ts
import { compactConversation, needsCompaction } from "@kitn/core";

if (needsCompaction(conversation, 80_000)) {
  const result = await compactConversation(ctx, conversationId);
  // result: { summary, summarizedCount, preservedCount, newMessageCount }
}
```

### Crons

Scheduled agent invocations -- recurring (cron expressions) or one-off (specific datetime).

- **`CronStore`** -- persists job definitions and execution records. Supports `getDueJobs()` for polling.
- **`CronScheduler`** -- pluggable trigger interface. Implementations register triggers with external services (Upstash, Cloudflare Workers, Vercel Cron, BullMQ) or use the built-in internal scheduler.
- **`createInternalScheduler()`** -- tick-based scheduler for long-running server processes. Polls `getDueJobs()` on a configurable interval (default: 60 seconds).
- **`executeCronJob()`** -- runs a cron job by invoking the target agent and recording the execution result.
- **`getNextRun()` / `validateCron()`** -- cron expression utilities.

```ts
import { createInternalScheduler } from "@kitn/core";

const scheduler = createInternalScheduler(ctx, {
  interval: 60_000,
  onComplete: (job, execution) => console.log(`Completed: ${job.name}`),
  onError: (job, error) => console.error(`Failed: ${job.name}`, error),
});
scheduler.start();
```

### Background Jobs

Asynchronous agent execution decoupled from the HTTP request lifecycle.

- **`executeJobInBackground()`** -- runs an agent in the background. Updates `JobStore` as execution progresses (queued -> running -> completed/failed/cancelled). Emits lifecycle hooks at each stage.
- **`createEventBuffer()`** -- in-memory SSE event buffer for reconnectable streaming. Clients that disconnect and reconnect can replay missed events.
- **`JobStore`** -- CRUD operations for background job records.

Jobs are triggered via `?async=true` on agent endpoints (handled by adapters). The adapter returns HTTP 202 with a `jobId`, and clients can reconnect to `/jobs/:id/stream` for live updates.

### Lifecycle Hooks

Plugin-level observability for agent execution, tool calls, delegation, jobs, and crons.

- **`createLifecycleHooks()`** -- creates a `LifecycleHookEmitter` with a configured detail level.
- **`createRedactedHooks()`** -- wraps an emitter with automatic secret redaction (API keys, tokens, passwords, credit cards, SSNs, emails).

Two detail levels:

| Level | Events |
|-------|--------|
| `summary` | `agent:start`, `agent:end`, `agent:error`, `job:start`, `job:end`, `job:cancelled`, `cron:executed` |
| `trace` | All summary events plus `tool:execute`, `delegate:start`, `delegate:end`, `model:call` |

Subscribe to specific events or use `"*"` for a wildcard:

```ts
import { createLifecycleHooks } from "@kitn/core";

const hooks = createLifecycleHooks({ level: "trace" });

hooks.on("agent:end", (data) => {
  console.log(`${data.agentName} completed in ${data.duration}ms`);
});

hooks.on("*", (event) => {
  // event.type identifies which event fired
  auditLog.write(event);
});
```

#### Redaction

Built-in patterns: `apiKeys`, `tokens`, `passwords`, `creditCards`, `ssn`, `emails`. Add custom patterns or skip specific fields:

```ts
import { createRedactedHooks, createLifecycleHooks } from "@kitn/core";

const hooks = createRedactedHooks(
  createLifecycleHooks({ level: "trace" }),
  {
    builtins: ["apiKeys", "passwords"],
    patterns: [{ name: "custom", regex: /SECRET_\w+/g }],
    skipFields: ["agentName", "timestamp"],
  },
);
```

### Resilience

Automatic retry with exponential backoff and model fallback for LLM calls.

- **`withResilience()`** -- wraps an LLM call with retry logic. Retries on rate limits (429), server errors (500-504), timeouts, and network failures. Respects `AbortSignal` for cancellation.
- **`isRetryableError()`** -- classifies whether an error is worth retrying.

Configured via `CoreConfig.resilience`:

```ts
const config: CoreConfig = {
  resilience: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterFactor: 0.2,
    onFallback: ({ currentModel, error }) => {
      // Switch to a fallback model when retries are exhausted
      return "gpt-4o-mini";
    },
  },
};
```

### Cards

Pluggable data extractors that inspect tool results and produce typed UI card data (weather cards, link previews, etc.).

- **`CardRegistry`** -- register extractor functions, then call `extract()` during streaming to collect cards without hardcoding tool-specific logic.

```ts
import { CardRegistry } from "@kitn/core";

const cards = new CardRegistry();
cards.register((toolName, result) => {
  if (toolName === "getWeather" && result?.location) {
    return { type: "weather", data: result };
  }
  return null;
});
```

### Self-Registration

Module-level registration functions for agents, tools, commands, and skills. Components call these at import time, then `registerWithPlugin()` flushes them into the `PluginContext`.

```ts
import { registerAgent, registerTool, registerWithPlugin } from "@kitn/core";

// Called at module load time
registerAgent({ name: "my-agent", description: "...", system: "...", tools: {} });
registerTool({ name: "my-tool", description: "...", inputSchema: schema, tool: myTool });

// After plugin creation
await registerWithPlugin(ctx);
```

### Plugins

Framework-agnostic plugin system for extending kitn with custom routes.

- **`KitnPlugin`** -- defines a `name`, URL `prefix`, and `routes` array. Each route specifies method, path, handler, and optional OpenAPI schema.
- Adapters (Hono, Elysia, etc.) mount plugin routes automatically.

```ts
import type { KitnPlugin } from "@kitn/core";

const myPlugin: KitnPlugin = {
  name: "custom",
  prefix: "/custom",
  routes: [
    {
      method: "GET",
      path: "/status",
      handler: async ({ pluginContext }) => {
        return new Response(JSON.stringify({ ok: true }));
      },
    },
  ],
};
```

### Streaming

Web-standard SSE streaming utilities.

- **`createSSEStream()`** -- creates a `Response` with `Content-Type: text/event-stream`. The handler receives an `SSEWriter` to write events.
- **`streamAgentResponse()`** -- streams an agent's response as SSE events including text deltas, tool calls, tool results, status updates, and cards.

### Events

Internal event system for real-time communication during agent execution.

- **`AgentEventBus`** -- pub/sub event bus used within a single request to propagate tool calls, delegation events, and status updates from agents to the streaming layer.
- **Event constants** -- `SSE_EVENTS`, `BUS_EVENTS`, `STATUS_CODES` define the event vocabulary.
- **`emitStatus()` / `writeStatus()`** -- emit structured status updates (thinking, processing, retrying, etc.).

### Token Estimation

- **`estimateTokens()`** -- estimates token count for a string (character-based heuristic).
- **`estimateMessageTokens()`** -- estimates total tokens across an array of conversation messages.

### Schemas

Zod schemas for request/response validation, used by OpenAPI-aware adapters:

- `agentRequestSchema`, `agentResponseSchema`, `agentPatchSchema`
- `memoryEntrySchema`, `memorySaveSchema`
- `skillMetaSchema`, `skillSchema`, `skillCreateSchema`, `skillUpdateSchema`
- `generateRequestSchema()`, `generateResponseSchema()` -- dynamic schema generators

## Key Types

```ts
import type {
  // Core context
  PluginContext,
  CoreConfig,
  AgentRequest,

  // Registries
  AgentRegistration,
  ToolRegistration,
  GuardResult,
  GuardContext,

  // Storage
  StorageProvider,
  ConversationStore,
  Conversation,
  ConversationMessage,
  MemoryStore,
  MemoryEntry,
  SkillStore,
  Skill,
  SkillMeta,
  TaskStore,
  Task,
  PromptStore,
  CommandStore,
  CronStore,
  CronJob,
  CronExecution,
  JobStore,
  Job,

  // Orchestration
  OrchestratorAgentConfig,
  TaskResult,
  ClarifyItem,
  DelegationContext,

  // Hooks
  LifecycleHookEmitter,
  LifecycleHookConfig,
  LifecycleEventMap,
  LifecycleEventName,

  // Resilience
  ResilienceConfig,
  FallbackContext,

  // Compaction
  CompactionConfig,
  CompactionResult,

  // Cards
  CardData,
  CardExtractor,

  // Plugins
  KitnPlugin,
  PluginRoute,

  // Crons
  CronScheduler,

  // Jobs
  JobExecutionContext,
  EventBuffer,

  // Streaming
  SSEWriter,
  SSEMessage,

  // Redaction
  RedactionConfig,
  RedactionPattern,
} from "@kitn/core";
```

## Framework-Agnostic

`@kitn/core` contains no HTTP framework bindings. To expose agents over HTTP, use an adapter:

- [`@kitn/adapters/hono`](../adapters/hono/) -- Hono adapter with route factories
- [`@kitn/adapters/hono-openapi`](../adapters/hono-openapi/) -- Hono OpenAPI adapter with auto-generated `/doc` spec
- [`@kitn/adapters/elysia`](../adapters/elysia/) -- Elysia adapter

## Tests

```bash
bun test packages/core
```

## Monorepo

This package is part of the [kitn monorepo](../../README.md).
