# kitn Example App

A Solid.js test client for interacting with the kitn API server.

## Features

The app is organized into a sidebar with four sections, each containing one or more panels:

**Overview**

- **Health** -- checks the API server's `/api/health` endpoint and displays the JSON response.

**Agents**

- **Agents** -- lists all registered agents, shows their tools, and provides quick-prompt buttons that fire SSE or JSON requests. Displays streamed text, raw SSE event logs, and request metadata (system prompt, format).
- **Chat** -- multi-turn conversation UI with agent selection, conversation persistence via `conversationId`, streaming responses, follow-up prompts, and a live event-log sidebar.
- **Orchestrator** -- tests the orchestrator agent with autonomous routing, multi-agent fan-out, and plan-mode (human-in-the-loop approval/rejection of task plans).

**Resources**

- **Tools** -- lists registered tools and invokes them directly (echo, getWeather, calculate) via `/api/tools/:name`.
- **Generate** -- exercises the low-level `/api/generate` endpoint with optional system prompts, tool selection, and SSE/JSON format toggle.
- **Voice** -- text-to-speech (with speaker/format selection and chunked playback), speech-to-text (microphone recording or file upload), full voice conversation round-trips, and a stored-audio library with playback and deletion.

**Data**

- **Memory** -- CRUD operations on the key-value memory store across namespaces (`/api/memory/:ns`).
- **Skills** -- create, view, update, and delete markdown-based agent skills (`/api/skills`).
- **Conversations** -- list, create, inspect, compact, and delete conversations (`/api/conversations`).

## Prerequisites

The kitn API server must be running on `localhost:4000` before starting this app. See the [monorepo root README](../../README.md) for server setup instructions.

## Setup

```bash
# From the monorepo root
bun install

# Start the dev server
bun run --cwd examples/app dev
```

The app runs on Vite's default port (`http://localhost:5173`).

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Base URL of the kitn API server |
| `VITE_API_KEY` | `test` | Value sent in the `X-API-Key` header |

## Tech Stack

- [Solid.js](https://www.solidjs.com/) -- reactive UI framework
- [Tailwind CSS v4](https://tailwindcss.com/) -- utility-first styling
- [Vite](https://vitejs.dev/) -- dev server and bundler
- `@kitn/client` -- workspace package providing `parseSseStream`, `chunkedSpeak`, and `AudioScheduler`

## API Proxy

Vite is configured to proxy all `/api` requests to `http://localhost:4000`, so the browser makes same-origin requests during development and avoids CORS issues. See `vite.config.ts`:

```ts
server: {
  proxy: {
    "/api": "http://localhost:4000",
  },
},
```

## More Information

See the [monorepo root README](../../README.md) for full documentation.
