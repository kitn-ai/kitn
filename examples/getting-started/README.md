# kitn Getting Started

The minimal example — what your project looks like after `kitn init` + `kitn add weather-agent`. If you want the comprehensive showcase with every feature, see [`api/`](../api/).

## What This Shows

- A kitn project with `kitn.json` config and `kitn.lock` tracking
- A weather agent and tool installed from the registry
- A simple Hono server wiring it all together
- Works with Node.js (no Bun required)

## Prerequisites

- [Node.js](https://nodejs.org) v18+ (or [Bun](https://bun.sh))
- An [OpenRouter API key](https://openrouter.ai/keys)

## Setup

1. Copy the environment file and add your API key:

```bash
cp .env.example .env
# Edit .env — set OPENROUTER_API_KEY
```

2. Install dependencies (from monorepo root):

```bash
bun install
```

3. Start the dev server:

```bash
bun run dev:getting-started
# or: cd examples/getting-started && npm run dev
```

The server starts at **http://localhost:4000**. All API routes are under `/api`.

## Project Structure

```
examples/getting-started/
  kitn.json               # kitn config (runtime, aliases, registries)
  kitn.lock               # Installed component tracking (auto-managed by CLI)
  src/
    index.ts              # Hono server — wires agents and tools
    agents/
      weather-agent.ts    # Agent config (installed via kitn add weather-agent)
    tools/
      weather.ts          # Weather tool (auto-installed as a dependency)
  .env.example            # Environment template
```

## Try It

### Chat with the weather agent

```bash
curl -N http://localhost:4000/api/agents/weather \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?"}'
```

### Call the weather tool directly

```bash
curl http://localhost:4000/api/tools/getWeather \
  -H "Content-Type: application/json" \
  -d '{"location": "Tokyo"}'
```

### List registered agents

```bash
curl http://localhost:4000/api/agents
```

## Adding More Components

Install the kitn CLI and add components from the registry:

```bash
# Install the CLI
npm install -g @kitnai/cli

# Browse available components
kitn list

# Add a component (installs files + dependencies automatically)
kitn add hackernews-agent
kitn add web-search-tool

# Check for updates
kitn diff
```

The CLI reads `kitn.json` to know where to install files and updates `kitn.lock` to track what's installed.

## Further Reading

- [`api/`](../api/) — comprehensive example with crons, commands, voice, and more
- [kitn CLI on npm](https://www.npmjs.com/package/@kitnai/cli) — full CLI documentation
- [Main README](../../README.md) — architecture overview
