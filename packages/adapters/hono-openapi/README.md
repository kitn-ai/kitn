# @kitnai/hono-openapi-adapter

OpenAPI-first AI agent backend for Hono. Every route is defined with `@hono/zod-openapi` schemas, producing a machine-readable OpenAPI 3.1.0 spec at `/doc`. Same agent, tool, and storage capabilities as the plain Hono adapter, but with typed request/response validation and auto-generated API documentation out of the box.

## Installation

```bash
bun add @kitnai/hono-openapi-adapter
```

Peer dependencies:

```bash
bun add hono @hono/zod-openapi ai zod
```

## Quick Start

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { createAIPlugin, createFileStorage } from "@kitnai/hono-openapi-adapter";
import { tool } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

const app = new OpenAPIHono();

const plugin = createAIPlugin({
  model: (model) => openai(model ?? "gpt-4o-mini"),
  storage: createFileStorage({ dataDir: "./data" }),
  openapi: {
    title: "My AI API",
    version: "1.0.0",
    description: "AI-powered API with auto-generated docs",
  },
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
app.route("/ai", plugin.router);

export default { port: 3000, fetch: app.fetch };
```

The OpenAPI JSON spec is served at `/ai/doc` (the mount prefix + `/doc`). Point any OpenAPI-compatible client or documentation tool (Scalar, Swagger UI, Redocly, etc.) at that URL.

## How It Differs from @kitnai/hono-adapter

| | `@kitnai/hono-adapter` | `@kitnai/hono-openapi-adapter` |
|---|---|---|
| Router | `Hono` | `OpenAPIHono` from `@hono/zod-openapi` |
| Route definitions | Plain `app.get()` / `app.post()` | `app.openapi(createRoute({ ... }))` with Zod schemas |
| Request validation | Manual | Automatic via Zod schemas in route definitions |
| Response schemas | None | Zod schemas documenting every response shape |
| OpenAPI spec | Not generated | Auto-generated OpenAPI 3.1.0 JSON at `/doc` |
| Extra peer dep | -- | `@hono/zod-openapi` |
| Voice routes | Included (opt-in) | Not included |

Choose the plain adapter when you want minimal dependencies and do not need generated API documentation. Choose the OpenAPI adapter when you want typed schemas, request validation, and a machine-readable spec for client generation or interactive docs.

## Configuration

`createAIPlugin(config)` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `(model?: string) => LanguageModel` | **required** | Returns an AI SDK `LanguageModel` for the given model name. |
| `storage` | `StorageProvider` | In-memory (ephemeral) | Persistence backend. Use `createFileStorage()` or implement your own. |
| `openapi` | `{ title?, version?, description?, serverUrl? }` | auto | Metadata for the generated OpenAPI spec. |
| `cronScheduler` | `CronScheduler` | disabled | Enables cron routes. Pass a scheduler implementation to mount `/crons`. |
| `hooks` | `LifecycleHooksConfig` | disabled | Lifecycle hook configuration for observability (agent:start/end, tool:execute, etc.). |
| `plugins` | `KitnPlugin[]` | `[]` | Additional kitn plugins to mount. Plugin routes with schemas are registered as OpenAPI routes. |
| `resilience` | `ResilienceConfig` | `{ maxRetries: 3 }` | Retry + fallback config for LLM calls. |
| `compaction` | `CompactionConfig` | `{ threshold: 20, preserveRecent: 4 }` | Auto-summarizes old messages when a conversation exceeds the threshold. |
| `maxDelegationDepth` | `number` | `3` | Max nesting depth for orchestrator delegation chains. |
| `defaultMaxSteps` | `number` | `5` | Default AI SDK `stepCount` limit per agent call. |
| `memoryStore` | `MemoryStore` | In-memory Map | Override the backing store for the built-in `_memory` tool. |
| `waitUntil` | `(promise: Promise) => void` | -- | For serverless: lets the runtime keep the function alive until plugins initialize. |

## API Routes

All routes are mounted under the prefix you choose (e.g., `/ai`). Every route below is defined with Zod request/response schemas and appears in the generated OpenAPI spec.

| Method | Path | Tag | Description |
|---|---|---|---|
| `POST` | `/generate` | RAG | Raw text generation (`?format=sse` for streaming) |
| `GET` | `/agents` | Agents | List registered agents |
| `GET` | `/agents/:name` | Agents | Agent details and current system prompt |
| `PATCH` | `/agents/:name` | Agents | Update or reset an agent's system prompt |
| `POST` | `/agents/:name` | Agents | Execute an agent (`?format=json\|sse`) |
| `POST` | `/agents/:name/:action` | Agents | Execute a named agent action |
| `POST` | `/agents/cancel` | Agents | Cancel an active agent stream by conversation ID |
| `GET` | `/tools` | Tools | List registered tools |
| `POST` | `/tools/:name` | Tools | Execute a tool directly |
| `GET` | `/conversations` | Conversations | List all conversations |
| `GET` | `/conversations/:id` | Conversations | Get full conversation history |
| `POST` | `/conversations` | Conversations | Create a new conversation |
| `DELETE` | `/conversations/:id` | Conversations | Delete a conversation |
| `DELETE` | `/conversations/:id/messages` | Conversations | Clear messages from a conversation |
| `POST` | `/conversations/:id/compact` | Conversations | Compact (summarize) a conversation |
| `GET` | `/memory` | Memory | List memory namespaces |
| `GET` | `/memory/:id` | Memory | List entries in a namespace |
| `POST` | `/memory/:id` | Memory | Save a memory entry |
| `GET` | `/memory/:id/:key` | Memory | Get a specific memory entry |
| `DELETE` | `/memory/:id/:key` | Memory | Delete a memory entry |
| `DELETE` | `/memory/:id` | Memory | Clear a namespace |
| `GET` | `/skills` | Skills | List all skills |
| `GET` | `/skills/:name` | Skills | Get a skill |
| `POST` | `/skills` | Skills | Create a skill |
| `PUT` | `/skills/:name` | Skills | Update a skill |
| `DELETE` | `/skills/:name` | Skills | Delete a skill |
| `GET` | `/commands` | Commands | List all commands |
| `GET` | `/commands/:name` | Commands | Get a command by name |
| `POST` | `/commands` | Commands | Create or update a command |
| `DELETE` | `/commands/:name` | Commands | Delete a command |
| `POST` | `/commands/:name/run` | Commands | Run a command |
| `GET` | `/jobs` | Jobs | List all background jobs |
| `GET` | `/jobs/:id` | Jobs | Get a background job by ID |
| `POST` | `/jobs/:id/cancel` | Jobs | Cancel a running or queued job |
| `DELETE` | `/jobs/:id` | Jobs | Delete a background job record |
| `GET` | `/plugins` | -- | List mounted plugins |

When `cronScheduler` is provided, the following routes are also mounted:

| Method | Path | Tag | Description |
|---|---|---|---|
| `GET` | `/crons` | Crons | List all cron jobs |
| `POST` | `/crons` | Crons | Create a cron job |
| `POST` | `/crons/tick` | Crons | Execute all due cron jobs |
| `GET` | `/crons/:id` | Crons | Get a cron job by ID |
| `PATCH` | `/crons/:id` | Crons | Update a cron job |
| `DELETE` | `/crons/:id` | Crons | Delete a cron job |
| `POST` | `/crons/:id/run` | Crons | Execute a specific cron job immediately |
| `GET` | `/crons/:id/history` | Crons | Get execution history for a cron job |

The OpenAPI JSON spec is available at `GET /doc`.

## Exports

```ts
import {
  // Plugin factory
  createAIPlugin,

  // Types
  type AIPluginConfig,
  type AIPluginInstance,

  // Hono request adapter
  toAgentRequest,

  // Everything from @kitnai/core is re-exported
  // (agents, tools, storage, memory, etc.)
} from "@kitnai/hono-openapi-adapter";
```

## Monorepo

This package is part of the [kitn monorepo](../../../README.md). See the root README for workspace setup and the full list of packages.
