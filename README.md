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
| `@kitnai/hono-adapter` | Plain Hono adapter — routes, plugin factory |
| `@kitnai/hono-openapi-adapter` | OpenAPI Hono adapter — zod-openapi routes, /doc spec |
| `@kitnai/elysia-adapter` | Elysia adapter |
| `@kitnai/client` | Browser utilities — SSE parsing, audio recording, chunked TTS playback |
| `@kitnai/cli` | CLI for the component registry — add, list, diff, update components |
| `@kitnai/cli-core` | Pure logic shared by CLI and MCP server — no UI, no protocol |
| `@kitnai/mcp-server` | MCP server — exposes kitn tools to Claude Code, Cursor, Copilot, etc. |

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
    adapters/
      hono/         # @kitnai/hono-adapter — plain Hono adapter
      hono-openapi/ # @kitnai/hono-openapi-adapter — OpenAPI Hono adapter
      elysia/       # @kitnai/elysia-adapter — Elysia adapter
    client/         # @kitnai/client — browser utilities
    cli-core/       # @kitnai/cli-core — pure logic (shared by CLI + MCP server)
    cli/            # @kitnai/cli — component registry CLI
    mcp-server/     # @kitnai/mcp-server — MCP server for AI coding assistants
  examples/
    api/            # Example REST API server
    app/            # Example Solid.js frontend
    voice/          # Example voice client
    getting-started/ # Minimal getting-started example
```

## MCP Server

The kitn MCP server lets any AI coding assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io/) manage kitn projects — install components, create agents, link tools, and more. Works with Claude Code, Cursor, VS Code Copilot, Windsurf, Zed, and others.

### Connect your editor

The hosted server is at `https://mcp.kitn.dev/mcp`:

**Claude Code:**
```bash
claude mcp add --transport http kitn https://mcp.kitn.dev/mcp
```

**Cursor** — add to `.cursor/mcp.json`:
```json
{ "mcpServers": { "kitn": { "url": "https://mcp.kitn.dev/mcp" } } }
```

**VS Code Copilot** — add to `.vscode/mcp.json`:
```json
{ "servers": { "kitn": { "type": "http", "url": "https://mcp.kitn.dev/mcp" } } }
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:
```json
{ "mcpServers": { "kitn": { "serverUrl": "https://mcp.kitn.dev/mcp" } } }
```

> For local development (running from source with auto-reload), see [MCP.md](MCP.md).

### Available Tools

| Tool | Description |
|------|-------------|
| `kitn_init` | Initialize kitn in a project |
| `kitn_add` | Install component(s) with dependency resolution |
| `kitn_remove` | Remove an installed component |
| `kitn_update` | Update to latest registry version |
| `kitn_create` | Scaffold a new agent, tool, skill, storage, or cron |
| `kitn_link` | Wire a tool into an agent |
| `kitn_unlink` | Remove a tool from an agent |
| `kitn_list` | List available and installed components |
| `kitn_info` | Full component details and docs |
| `kitn_diff` | Local vs registry diff |
| `kitn_project` | Get project context (config, installed components) |
| `kitn_rules` | Regenerate AI coding rules files |
| `kitn_registry_search` | Search configured registries |
| `kitn_registry_list` | Show configured registries |
| `kitn_registry_add` | Add a custom registry |
| `kitn_help` | Get kitn coding guidance on a topic |

## Development

```bash
# Install all dependencies
bun install

# Run all three examples concurrently (api + app + voice)
bun run dev

# Examples
bun run dev:api       # API server on :4000
bun run dev:app       # Frontend on :5173
bun run dev:voice     # Voice client on :5174

# MCP server and CLI
bun run dev:mcp       # MCP server with --watch (auto-restarts on changes)
bun run dev:cli       # Build and run CLI locally

# Quick run (assumes already built)
bun run mcp           # MCP server from dist (stdio)
bun run mcp:http      # MCP server from dist (HTTP on :8080)
bun run mcp:inspect   # MCP Inspector web UI
bun run cli           # CLI from dist

# Build
bun run build         # All packages
bun run build:mcp     # cli-core + mcp-server
bun run build:cli     # cli-core + cli
bun run build:core    # cli-core only

# Test
bun run test          # All packages
bun run test:core     # @kitnai/core
bun run test:cli      # @kitnai/cli
bun run test:cli-core # @kitnai/cli-core

# Typecheck everything
bun run typecheck
```

## License

MIT
