# @kitnai/hono

Drop-in AI agent backend for Hono. Register agents, tools, and skills, then mount a single plugin to get a full REST + SSE API with conversations, memory, orchestration, and voice.

## Installation

```bash
bun add @kitnai/hono
```

Peer dependencies:

```bash
bun add hono @hono/zod-openapi ai zod
```

## Quick Start

```ts
import { Hono } from "hono";
import { createAIPlugin, createFileStorage } from "@kitn/routes";
import { tool } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

const app = new Hono();

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
app.route("/ai", plugin.app);

await plugin.initialize();
export default { port: 3000, fetch: app.fetch };
```

Send a request:

```bash
# SSE stream
curl -N -H "X-API-Key: $KEY" \
  -d '{"message":"Weather in Tokyo?"}' \
  http://localhost:3000/ai/agents/weather

# JSON
curl -H "X-API-Key: $KEY" \
  -d '{"message":"Weather in Tokyo?"}' \
  "http://localhost:3000/ai/agents/weather?format=json"
```

## Configuration

`createAIPlugin(config)` accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `(model?: string) => LanguageModel` | **required** | Returns an AI SDK `LanguageModel` for the given model name. |
| `storage` | `StorageProvider` | In-memory (ephemeral) | Persistence backend. Use `createFileStorage()` or implement your own. |
| `voice` | `VoiceConfig` | disabled | Enables voice routes. Set `{ retainAudio: true }` to persist audio files. |
| `resilience` | `ResilienceConfig` | `{ maxRetries: 3 }` | Retry + fallback config for LLM calls. Supports exponential backoff with jitter and a fallback model hook. |
| `compaction` | `CompactionConfig` | `{ threshold: 20, preserveRecent: 4 }` | Auto-summarizes old messages when a conversation exceeds the threshold. |
| `maxDelegationDepth` | `number` | `3` | Max nesting depth for orchestrator delegation chains. |
| `defaultMaxSteps` | `number` | `5` | Default AI SDK `stepCount` limit per agent call. |
| `memoryStore` | `MemoryStore` | In-memory Map | Override the backing store for the built-in `_memory` tool. |
| `openapi` | `{ title?, version?, description?, serverUrl? }` | auto | Metadata for the generated OpenAPI/Scalar docs. |

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

### Voice

Optional speech-to-text and text-to-speech via pluggable `VoiceProvider` implementations. The `/voice/converse` endpoint provides a full audio-in/audio-out cycle: transcribe, run agent, speak response.

### Cards

Structured data extractors that run on tool results. Register extractors on `plugin.cards` to automatically surface UI-friendly data (e.g., weather cards, search result cards) alongside agent responses.

## Storage

Two built-in storage implementations are included:

```ts
import { createFileStorage, createMemoryStorage } from "@kitn/routes";

// File-based (JSON files in a directory)
const storage = createFileStorage({ dataDir: "./data" });

// In-memory (ephemeral, for dev/testing)
const storage = createMemoryStorage();
```

For custom backends (Postgres, Redis, S3, etc.), implement the `StorageProvider` interface which aggregates six sub-stores:

```ts
interface StorageProvider {
  conversations: ConversationStore;
  memory: MemoryStore;
  skills: SkillStore;
  tasks: TaskStore;
  prompts: PromptStore;
  audio: AudioStore;
}
```

Each sub-store interface is exported from `@kitn/routes` and documented with JSDoc including usage contracts (e.g., return `null` on not-found, auto-create on first write).

## API Routes

All routes are mounted under the prefix you choose (e.g., `/ai`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (agent/tool counts) |
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
| `GET` | `/voice/speakers` | List available TTS voices |
| `GET` | `/voice/providers` | List transcription providers |
| `POST` | `/voice/transcribe` | Transcribe audio to text |
| `POST` | `/voice/speak` | Convert text to speech |
| `POST` | `/voice/converse` | Full voice conversation (audio in, audio out) |
| `GET` | `/voice/audio` | List stored audio entries |
| `GET` | `/voice/audio/:id` | Retrieve a stored audio file |
| `DELETE` | `/voice/audio/:id` | Delete a stored audio file |

Interactive API docs are served at `/doc` (Scalar UI) when the plugin is mounted.

## Monorepo

This package is part of the [kitn monorepo](../../README.md). See the root README for workspace setup and the full list of packages.
