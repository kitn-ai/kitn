# kitn

A TypeScript framework for building multi-agent AI systems. Kitn gives you agents, tools, memory, voice, and orchestration as a Hono plugin — mount it on any server and go.

## Features

- **Agents** — Register agents with tools, system prompts, and guard functions. Each agent gets SSE streaming and JSON endpoints automatically.
- **Orchestration** — Built-in orchestrator routes queries to specialist agents with delegation tracking and depth limits.
- **Tools** — Define tools with Zod schemas via the Vercel AI SDK. Tools work inside agents and as standalone REST endpoints.
- **Memory** — Namespaced key-value store that agents can read/write. Memory context is injected into conversations automatically.
- **Skills** — Reusable behavioral instructions (like "respond concisely" or "think step-by-step") that can be toggled per-agent.
- **Voice** — Speech-to-text and text-to-speech with provider abstraction (OpenAI, Groq).
- **Conversations** — Persistent multi-turn history with automatic compaction (LLM summarization) for long-running chats.
- **Resilience** — Retry with exponential backoff and fallback model switching.
- **Storage** — Pluggable backends: file-based JSON storage for development, in-memory for testing, or implement your own.
- **Component Registry** — Discover and install pre-built agents, tools, and skills from the kitn registry.

## Packages

| Package | Description |
|---------|-------------|
| `@kitnai/core` | Framework-agnostic engine — agents, tools, storage, memory, events, voice |
| `@kitnai/hono` | Hono adapter — plugin factory, OpenAPI routes, Scalar docs |
| `@kitnai/client` | Browser utilities — SSE parsing, audio recording, chunked TTS playback |
| `@kitnai/cli` | CLI for the component registry — add, list, diff, update components |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3+
- An API key from [OpenRouter](https://openrouter.ai/), OpenAI, or any AI SDK-compatible provider

### Install

```bash
git clone https://github.com/kitn-ai/kitn.git
cd kitn
bun install
```

### Run the example API

```bash
cp examples/api/.env.example examples/api/.env
# Edit .env with your API keys

bun run --cwd examples/api dev
```

The server starts at `http://localhost:4000`. All routes are under `/api`:

```bash
# List available agents
curl http://localhost:4000/api/agents -H "X-API-Key: test"

# Chat with an agent (SSE)
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: test" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the weather in Tokyo?"}'
```

### Run the example app

In a second terminal:

```bash
bun run --cwd examples/app dev
```

Opens a Solid.js frontend at `http://localhost:5173` with panels for agents, chat, orchestration, generation, and voice.

### Run the example voice client

```bash
bun run --cwd examples/voice dev
```

A standalone voice interface for recording and playing back AI-generated speech.

## Usage

Create a server with `createAIPlugin`, register your agents and tools, and mount it:

```ts
import { Hono } from "hono";
import { createAIPlugin, createFileStorage } from "@kitn/routes";
import { openrouter } from "@openrouter/ai-sdk-provider";

const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? "openai/gpt-4o-mini"),
  storage: createFileStorage({ dataDir: "./data" }),
});

// Register a tool
plugin.tools.register({
  name: "greet",
  description: "Greet someone by name",
  inputSchema: z.object({ name: z.string() }),
  tool: tool({
    description: "Greet someone",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => ({ message: `Hello, ${name}!` }),
  }),
  directExecute: async (input) => ({ message: `Hello, ${input.name}!` }),
});

// Register an agent with that tool
const tools = { greet: greetTool };
const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

plugin.agents.register({
  name: "greeter",
  description: "A friendly greeting agent",
  toolNames: ["greet"],
  defaultSystem: "You are a friendly assistant. Greet users by name when asked.",
  tools,
  sseHandler,
  jsonHandler,
});

// Mount on a Hono app
const app = new Hono();
app.route("/api", plugin.app);

export default { port: 4000, fetch: app.fetch };
```

## API Endpoints

All routes require an `X-API-Key` header unless noted.

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check (no auth) |
| `/agents` | GET | List registered agents |
| `/agents/:name` | GET | Agent details |
| `/agents/:name` | POST | Execute agent (SSE or JSON) |
| `/agents/:name` | PATCH | Update agent system prompt |
| `/tools` | GET | List registered tools |
| `/tools/:name` | POST | Execute a tool directly |
| `/skills` | GET | List skills |
| `/skills` | POST | Create a skill |
| `/skills/:id` | PUT | Update a skill |
| `/skills/:id` | DELETE | Delete a skill |
| `/memory` | GET | List memory namespaces |
| `/memory/:ns` | GET | Get entries in a namespace |
| `/memory/:ns` | POST | Save a memory entry |
| `/conversations` | GET | List conversations |
| `/conversations/:id` | GET | Get conversation messages |
| `/conversations/:id` | DELETE | Delete a conversation |
| `/generate` | POST | Raw LLM generation with optional tools |
| `/voice/transcribe` | POST | Audio to text |
| `/voice/speak` | POST | Text to audio (SSE) |
| `/voice/speakers` | GET | List available voices |
| `/voice/providers` | GET | List voice providers |

## Project Structure

```
kitn/
  packages/
    core/           # @kitnai/core — framework-agnostic engine
    hono/           # @kitnai/hono — Hono adapter
    client/         # @kitnai/client — browser utilities
    cli/            # @kitnai/cli — component registry CLI
  examples/
    api/            # Example REST API server
    app/            # Example Solid.js frontend
    voice/          # Example voice client
    getting-started/ # Minimal getting-started example
```

## Development

```bash
# Install all dependencies
bun install

# Run all three examples concurrently (api + app + voice)
bun run dev

# Or run them individually
bun run dev:api     # API server on :4000
bun run dev:app     # Frontend on :5173
bun run dev:voice   # Voice client on :5174

# Typecheck everything
bun run typecheck

# Run tests
bun run test

# Build all packages
bun run build

```

## License

MIT
