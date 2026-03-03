# @kitnai/elysia-adapter

Elysia adapter for kitn AI agents. Register agents, tools, and skills, then mount a single plugin to get a full REST + SSE API with conversations, memory, orchestration, cron scheduling, and background jobs.

## Installation

```bash
bun add @kitnai/elysia-adapter
```

Peer dependencies:

```bash
bun add elysia ai zod
```

## Quick Start

```ts
import { Elysia } from "elysia";
import { createAIPlugin, createFileStorage } from "@kitn/adapters/elysia";
import { tool } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

const plugin = createAIPlugin({
  model: (model) => openai(model ?? "gpt-4o-mini"),
  storage: createFileStorage({ dataDir: "./data" }),
});

// Register a tool
const getWeather = tool({
  description: "Get weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ temp: 72, city }),
});

plugin.tools.register({
  name: "getWeather",
  description: "Get weather for a city",
  inputSchema: z.object({ city: z.string() }),
  tool: getWeather,
});

// Register an agent that uses the tool
const { sseHandler, jsonHandler } = plugin.createHandlers({
  tools: { getWeather },
});

plugin.agents.register({
  name: "weather",
  description: "Answers weather questions",
  toolNames: ["getWeather"],
  tools: { getWeather },
  defaultFormat: "sse",
  defaultSystem: "You are a weather assistant.",
  sseHandler,
  jsonHandler,
});

// Optionally add an orchestrator that routes across agents
plugin.createOrchestrator({ name: "orchestrator" });

// Mount and start
const app = new Elysia()
  .use(plugin.router)
  .listen(3000);

console.log(`Listening on http://localhost:${app.server!.port}`);
```

Send a request:

```bash
# SSE stream
curl -N -d '{"message":"Weather in Tokyo?"}' \
  http://localhost:3000/agents/weather

# JSON
curl -d '{"message":"Weather in Tokyo?"}' \
  "http://localhost:3000/agents/weather?format=json"
```

## Configuration

`createAIPlugin(config)` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `(model?: string) => LanguageModel` | **required** | Returns an AI SDK `LanguageModel` for the given model name. |
| `storage` | `StorageProvider` | In-memory (ephemeral) | Persistence backend. Use `createFileStorage()` or implement your own. |
| `memoryStore` | `MemoryStore` | In-memory Map | Override the backing store for the built-in `_memory` tool. |
| `cronScheduler` | `CronScheduler` | disabled | Enables cron routes. Provide a scheduler implementation to manage recurring jobs. |
| `resilience` | `ResilienceConfig` | `{ maxRetries: 3 }` | Retry + fallback config for LLM calls. Supports exponential backoff with jitter and a fallback model hook. |
| `compaction` | `CompactionConfig` | `{ threshold: 20, preserveRecent: 4 }` | Auto-summarizes old messages when a conversation exceeds the threshold. |
| `hooks` | `LifecycleHookConfig` | disabled | Enables lifecycle event emission. Subscribe via `plugin.on()`. |
| `maxDelegationDepth` | `number` | `3` | Max nesting depth for orchestrator delegation chains. |
| `defaultMaxSteps` | `number` | `5` | Default AI SDK `stepCount` limit per agent call. |
| `waitUntil` | `(promise: Promise<unknown>) => void` | none | Platform-specific background execution for serverless environments. |
| `plugins` | `KitnPlugin[]` | `[]` | Additional kitn plugins to mount. |

## Key Concepts

### Agents

An agent is a named AI personality with a system prompt and a set of tools. Register agents on `plugin.agents` and they are automatically exposed via `POST /agents/:name`. Each agent supports SSE streaming and/or JSON response formats.

### Tools

Tools are AI SDK tool definitions registered on `plugin.tools`. They can be called directly via `POST /tools/:name` or used by agents during generation. Each tool can optionally include a `directExecute` function and structured `examples` for improved accuracy.

### Orchestrator

A meta-agent that routes queries to specialist agents. It can delegate directly (`routeToAgent`) or create parallel sub-tasks (`createTask`), then synthesize the combined results. Supports plan mode (propose tasks, await approval) and autonomous mode (execute immediately).

### Skills

Markdown documents with YAML frontmatter that inject behavioral instructions into agent prompts. Skills have a `phase` (`query`, `response`, or `both`) that controls when their content is applied. Managed via the `/skills` CRUD API.

### Memory

Namespaced key-value store that persists information across conversations. Agents get a built-in `_memory` tool automatically (disable per-agent with `disableMemoryTool: true`). Memory entries can also be loaded into agent context at call time via `memoryIds`.

### Conversations

Multi-turn conversation history with automatic compaction. Pass a `conversationId` in agent requests to maintain context. Conversations support manual compaction via API or auto-compaction when the message count exceeds the configured threshold.

### Commands

Stored prompt templates with optional tool bindings. Create commands via the `/commands` API and execute them with `POST /commands/:name/run`. Each command can specify a system prompt, tools, model, and default response format.

### Cron Scheduling

Recurring agent execution via the `/crons` API. Requires a `cronScheduler` in the plugin config. Supports CRUD for cron jobs, a `/crons/tick` endpoint for external trigger-based scheduling, and per-job execution history.

### Background Jobs

Async agent execution that returns HTTP 202 with a `jobId`. Poll job status via `/jobs/:id` or cancel with `POST /jobs/:id/cancel`. Useful for long-running agent tasks.

### Lifecycle Hooks

Observable events emitted during agent execution. Enable by setting `hooks` in the plugin config, then subscribe with `plugin.on("agent:start", handler)` or wildcard `plugin.on("*", handler)`.

### Cards

Structured data extractors that run on tool results. Register extractors on `plugin.cards` to automatically surface UI-friendly data (e.g., weather cards, search result cards) alongside agent responses.

## Storage

Two built-in storage implementations are included:

```ts
import { createFileStorage, createMemoryStorage } from "@kitn/adapters/elysia";

// File-based (JSON files in a directory)
const storage = createFileStorage({ dataDir: "./data" });

// In-memory (ephemeral, for dev/testing)
const storage = createMemoryStorage();
```

For custom backends (Postgres, Redis, S3, etc.), implement the `StorageProvider` interface which aggregates sub-stores:

```ts
interface StorageProvider {
  conversations: ConversationStore;
  memory: MemoryStore;
  skills: SkillStore;
  tasks: TaskStore;
  prompts: PromptStore;
  audio: AudioStore;
  commands: CommandStore;
  crons: CronStore;
  jobs: JobStore;
}
```

Each sub-store interface is exported from `@kitn/adapters/elysia` and documented with JSDoc including usage contracts (e.g., return `null` on not-found, auto-create on first write).

## API Routes

All routes are mounted under the prefix you choose (e.g., `.use(plugin.router)` at the root, or nest under a group).

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate` | Raw text generation (`?format=sse` for streaming) |
| `GET` | `/agents` | List registered agents |
| `GET` | `/agents/:name` | Agent details and current system prompt |
| `PATCH` | `/agents/:name` | Update or reset an agent's system prompt |
| `POST` | `/agents/:name` | Execute an agent (`?format=json\|sse`) |
| `POST` | `/agents/:name/:action` | Execute a named agent action |
| `POST` | `/agents/cancel` | Cancel an active agent stream by conversation ID |
| `GET` | `/tools` | List registered tools |
| `POST` | `/tools/:name` | Execute a tool directly |
| `GET` | `/conversations` | List all conversations |
| `GET` | `/conversations/:id` | Get full conversation history |
| `POST` | `/conversations` | Create a new conversation |
| `DELETE` | `/conversations/:id` | Delete a conversation |
| `DELETE` | `/conversations/:id/messages` | Clear messages from a conversation |
| `POST` | `/conversations/:id/compact` | Compact (summarize) a conversation |
| `GET` | `/memory` | List memory namespaces |
| `GET` | `/memory/:id` | List entries in a namespace |
| `POST` | `/memory/:id` | Save a memory entry |
| `GET` | `/memory/:id/:key` | Get a specific memory entry |
| `DELETE` | `/memory/:id/:key` | Delete a memory entry |
| `DELETE` | `/memory/:id` | Clear a namespace |
| `GET` | `/skills` | List all skills |
| `GET` | `/skills/:name` | Get a skill |
| `POST` | `/skills` | Create a skill |
| `PUT` | `/skills/:name` | Update a skill |
| `DELETE` | `/skills/:name` | Delete a skill |
| `GET` | `/commands` | List stored commands |
| `GET` | `/commands/:name` | Get a command |
| `POST` | `/commands` | Create a command |
| `DELETE` | `/commands/:name` | Delete a command |
| `POST` | `/commands/:name/run` | Execute a command (`?format=json\|sse`) |
| `GET` | `/jobs` | List background jobs |
| `GET` | `/jobs/:id` | Get job status |
| `POST` | `/jobs/:id/cancel` | Cancel a running or queued job |
| `DELETE` | `/jobs/:id` | Delete a job |
| `GET` | `/plugins` | List mounted plugins |

When `cronScheduler` is provided in the config, the following routes are also mounted:

| Method | Path | Description |
|---|---|---|
| `GET` | `/crons` | List cron jobs |
| `POST` | `/crons` | Create a cron job |
| `POST` | `/crons/tick` | Execute all due cron jobs |
| `GET` | `/crons/:id` | Get a cron job |
| `PATCH` | `/crons/:id` | Update a cron job |
| `DELETE` | `/crons/:id` | Delete a cron job |
| `POST` | `/crons/:id/run` | Manually trigger a cron job |
| `GET` | `/crons/:id/history` | Get execution history for a cron job |

## Exports

The package re-exports everything from `@kitnai/core` for convenience, plus the Elysia-specific exports:

| Export | Description |
|---|---|
| `createAIPlugin(config)` | Creates the plugin instance with an Elysia router |
| `AIPluginConfig` | Configuration type for `createAIPlugin` |
| `AIPluginInstance` | Return type of `createAIPlugin` (extends `PluginContext`) |
| `toAgentRequest(ctx)` | Converts an Elysia handler context to the framework-agnostic `AgentRequest` |

## Monorepo

This package is part of the [kitn monorepo](../../../README.md). See the root README for workspace setup and the full list of packages.
