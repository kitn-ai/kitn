# kitn Getting Started

Minimal example showing how to use kitn components with `@kitn/hono-routes`.

This project contains a weather agent and tool as if installed via `kitn add weather-agent`.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy the environment file and add your API key:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY
```

3. Start the server:

```bash
bun run dev
```

## What's Included

```
src/
  agents/
    weather-agent.ts    # Agent config (installed via kitn add weather-agent)
  tools/
    weather.ts          # Weather tool (auto-installed as a dependency)
  index.ts              # Hono server wiring everything together
kitn.json               # kitn configuration tracking installed components
```

## Usage

Once running, the server exposes:

- `GET /api/health` — health check
- `GET /api/agents` — list registered agents
- `POST /api/agents/weather` — chat with the weather agent (SSE)
- `POST /api/tools/getWeather` — call the weather tool directly
- `GET /api/doc` — interactive API documentation

### Example: Chat with the weather agent

```bash
curl -N -X POST http://localhost:4000/api/agents/weather \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?"}'
```

### Example: Call a tool directly

```bash
curl -X POST http://localhost:4000/api/tools/getWeather \
  -H "Content-Type: application/json" \
  -d '{"input": {"location": "Tokyo"}}'
```

## Next Steps

- Run `kitn add` to install more components from the registry
- See `kitn list` for all available components
- Read the [Using Components](../../docs/guides/using-components.md) guide for wiring patterns
- Read the [Creating Components](../../docs/guides/creating-components.md) guide to contribute your own
