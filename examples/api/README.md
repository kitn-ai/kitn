# kitn API Example

The comprehensive example — every kitn feature wired up manually in one Hono server. If you want the quick CLI-based path instead, see [`getting-started/`](../getting-started/).

## What's Inside

- **6 tools** — echo, weather, calculator, web search, Hacker News (top stories + detail)
- **2 agents** — general (multi-tool) and guarded (input filtering)
- **Orchestrator** — autonomous agent routing
- **Cron scheduling** — InternalScheduler with sample hourly job
- **Commands** — stored command definitions via the commands API
- **MCP Server** — expose tools and agents via Model Context Protocol at `/mcp`
- **MCP Client** — consume external MCP servers as tool sources (optional, e.g. Context7 docs)
- **Voice** — OpenAI and Groq TTS/STT providers (optional)
- **File storage** — conversations, memory, skills, commands, crons persisted to `data/`
- **Resilience** — automatic retries with exponential backoff
- **Compaction** — automatic conversation compaction after 20 messages

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- An [OpenRouter API key](https://openrouter.ai/keys) (required)
- A [Brave Search API key](https://brave.search.com/api) (optional, for web search)
- OpenAI or Groq API key (optional, for voice)

> **Tip:** Install the [kitn CLI](https://www.npmjs.com/package/@kitnai/cli) to add components to your own projects:
> ```bash
> bunx @kitnai/cli init
> bunx @kitnai/cli add weather-agent
> ```

## Setup

1. Copy the environment file and add your API key:

```bash
cp .env.example .env
# Edit .env — at minimum set OPENROUTER_API_KEY
```

2. Install dependencies (from monorepo root):

```bash
bun install
```

3. Start the dev server:

```bash
bun run dev:api
# or: cd examples/api && bun run dev
```

The server starts at **http://localhost:4000**. All API routes are under `/api`.

## Project Structure

```
examples/api/
  src/
    index.ts              # Server entry — wires everything together
    env.ts                # Environment validation (t3-env + Zod)
    agents/
      general.ts          # Multi-tool agent (weather, search, HN, calculator, echo)
      guarded.ts          # Agent with input guard (blocks keyword "blocked")
    tools/
      calculator.ts       # Math expression evaluator
      echo.ts             # Echo utility
      hackernews.ts       # Hacker News top stories + story detail
      weather.ts          # Open-Meteo weather (no API key needed)
      web-search.ts       # Brave Search (requires BRAVE_API_KEY)
  data/                   # File storage (persisted across restarts)
    conversations/        # Saved conversation histories
    memory/               # Agent memory namespaces
    audio/                # Voice audio files (when VOICE_RETAIN_AUDIO=true)
    skills/               # Skill definitions (markdown with YAML front matter)
    prompt-overrides.json # System prompt overrides set via PATCH
  .env.example            # Environment template
```

## Agents

| Agent | Description | Tools |
|---|---|---|
| `general` | General-purpose assistant | echo, weather, calculator, web search, Hacker News |
| `guarded` | Input guard demo — blocks messages containing "blocked" | echo |
| `orchestrator` | Routes queries to the best specialist agent | (delegates) |

## Tools

| Tool | Category | API Key? | Description |
|---|---|---|---|
| `echo` | utility | No | Echoes back the input message |
| `getWeather` | weather | No | Current weather from Open-Meteo |
| `calculate` | utility | No | Math expression evaluator (`+`, `-`, `*`, `/`, `%`, `^`) |
| `searchWeb` | search | BRAVE_API_KEY | Web search via Brave Search |
| `hackernewsTopStories` | news | No | Top stories from Hacker News |
| `hackernewsStoryDetail` | news | No | Story detail with top comments |

## Try It

All requests use `X-API-Key: demo` (configurable via `API_KEY` env var).

### Chat with an agent

```bash
# SSE streaming (default)
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?"}'

# JSON response
curl http://localhost:4000/api/agents/general?format=json \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 42 * 17?"}'
```

### Use the orchestrator

```bash
curl -N http://localhost:4000/api/agents/orchestrator \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the top stories on Hacker News?"}'
```

### Call a tool directly

```bash
curl http://localhost:4000/api/tools/getWeather \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"location": "Paris"}'

curl http://localhost:4000/api/tools/hackernewsTopStories \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

### Cron scheduling

The example seeds an hourly cron job that asks the general agent for a Hacker News digest.

```bash
# List cron jobs
curl http://localhost:4000/api/crons \
  -H "X-API-Key: demo"

# Create a new cron job
curl http://localhost:4000/api/crons \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "weather-check",
    "schedule": "*/30 * * * *",
    "agentName": "general",
    "input": "Check the weather in San Francisco and give a brief summary."
  }'

# Manually trigger a job
curl -X POST http://localhost:4000/api/crons/{id}/run \
  -H "X-API-Key: demo"

# View execution history
curl http://localhost:4000/api/crons/{id}/history \
  -H "X-API-Key: demo"
```

### Commands

```bash
# List commands
curl http://localhost:4000/api/commands \
  -H "X-API-Key: demo"

# Run a command
curl http://localhost:4000/api/commands/status \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me the current server status"}'
```

### Conversations

```bash
# Chat with conversation memory
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "Remember that my name is Alice", "conversationId": "session-1"}'

# Continue the conversation
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my name?", "conversationId": "session-1"}'
```

### Prompt overrides

```bash
# Override an agent's system prompt
curl -X PATCH http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"system": "You are a pirate. Respond in pirate speak."}'

# Reset to default
curl -X PATCH http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"reset": true}'
```

### MCP Server

The server exposes kitn tools and agents via the Model Context Protocol at `/mcp`. Any MCP-compatible client (Claude Desktop, Cursor, etc.) can connect to it.

```bash
# Initialize — send an MCP request to list available tools
curl http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'

# Call a tool via MCP
curl http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "getWeather",
      "arguments": { "location": "London" }
    }
  }'
```

### MCP Client (optional)

When `MCP_CONTEXT7=true`, the server connects to the [Context7](https://context7.com) MCP server at startup, making documentation lookup tools available to agents.

```bash
# Enable in .env
MCP_CONTEXT7=true

# The general agent can now use Context7 tools
curl -N http://localhost:4000/api/agents/general \
  -H "X-API-Key: demo" \
  -H "Content-Type: application/json" \
  -d '{"message": "Look up the Hono framework documentation for routing"}'
```

## Configuration

Environment variables are validated at startup. The server exits with a clear error if required values are missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Yes | — | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `DEFAULT_MODEL` | No | `openai/gpt-4o-mini` | Default LLM model |
| `API_KEY` | No | `demo` | Client auth key (`X-API-Key` header) |
| `PORT` | No | `4000` | Server port |
| `BRAVE_API_KEY` | No | — | Enables web search tool |
| `OPENAI_API_KEY` | No | — | Enables OpenAI voice (TTS/STT) |
| `GROQ_API_KEY` | No | — | Enables Groq voice (Whisper STT) |
| `MCP_CONTEXT7` | No | `false` | Enables Context7 MCP client (documentation tools) |

## Further Reading

- [`getting-started/`](../getting-started/) — minimal example using the kitn CLI
- [kitn CLI on npm](https://www.npmjs.com/package/@kitnai/cli) — `kitn init`, `kitn add`, `kitn list`
- [Main README](../../README.md) — full architecture overview
