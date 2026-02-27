# Build an AI Agent API with kitn

This tutorial walks you through creating a new project from scratch, installing kitn components, and running an AI agent server with tools, conversations, and API documentation.

**What you'll build:** A Hono API server with a weather agent that can look up real weather data, with streaming chat, conversation history, and interactive Scalar API docs.

**Prerequisites:**
- [Bun](https://bun.sh) installed (or Node.js 18+)
- An [OpenRouter](https://openrouter.ai) API key (free tier works)

## 1. Create the project

```bash
mkdir my-ai-api && cd my-ai-api
bun init -y
```

## 2. Initialize kitn

```bash
bunx @kitnai/cli init
```

Choose:
- **Runtime:** Bun
- **Install path:** `src/ai` (default)

This creates a `kitn.json` config file and automatically installs the core engine and Hono routes into your project. npm dependencies (`hono`, `@hono/zod-openapi`, `zod`, `ai`, etc.) are installed automatically.

## 3. Browse and install components

See what's available:

```bash
bunx @kitnai/cli list
```

Install the weather agent (its weather-tool dependency is pulled in automatically):

```bash
bunx @kitnai/cli add weather-agent
```

This creates:
```
src/ai/
  agents/
    weather-agent.ts    # Agent config with system prompt
  tools/
    weather.ts          # Weather tool using Open-Meteo API (free, no key needed)
```

## 4. Install your AI provider

You'll need an AI provider SDK. OpenRouter is recommended since it gives access to many models:

```bash
bun add @openrouter/ai-sdk-provider
```

## 5. Set up TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

> Note: `kitn init` patches your tsconfig with path aliases automatically. If you already have a tsconfig, the CLI will merge into it.

## 6. Create the server

Create `src/index.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createAIPlugin } from "@kitn/routes";
import { openrouter } from "@openrouter/ai-sdk-provider";

// Import the components you installed via `kitn add`
import { weatherTool } from "./ai/tools/weather.js";
import { WEATHER_AGENT_CONFIG } from "./ai/agents/weather-agent.js";

// --- Config ---

const PORT = Number(process.env.PORT ?? 4000);
const MODEL = process.env.DEFAULT_MODEL ?? "openai/gpt-4o-mini";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY. Create a .env file.");
  process.exit(1);
}

// --- Plugin setup ---

const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? MODEL),
});

// --- Register tools ---

plugin.tools.register({
  name: "getWeather",
  description: "Get current weather for a location",
  inputSchema: z.object({ location: z.string() }),
  tool: weatherTool,
  directExecute: async (input) =>
    weatherTool.execute!(input, { toolCallId: "direct" } as any),
  category: "weather",
});

// --- Register agents ---

const tools = WEATHER_AGENT_CONFIG.tools;
const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

plugin.agents.register({
  name: "weather",
  description: "Weather specialist agent",
  toolNames: Object.keys(tools),
  defaultFormat: "sse",
  defaultSystem: WEATHER_AGENT_CONFIG.system,
  tools,
  sseHandler,
  jsonHandler,
});

// --- Build the app ---

const app = new Hono();
app.use("/*", cors());
app.route("/api", plugin.router);

console.log(`Server running on http://localhost:${PORT}`);
console.log(`API Reference: http://localhost:${PORT}/api/reference`);

export default {
  port: PORT,
  fetch: app.fetch,
};
```

## 7. Add environment variables

If components you installed declare required environment variables, the CLI will have prompted you during `kitn add` and generated a `.env.example` file. Check it for any variables you still need to set.

For this tutorial, you need an OpenRouter API key. If you didn't enter it during install, add it to `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
DEFAULT_MODEL=openai/gpt-4o-mini
PORT=4000
```

Get your key at [openrouter.ai/keys](https://openrouter.ai/keys).

## 8. Run it

```bash
bun --watch src/index.ts
```

You should see:

```
Server running on http://localhost:4000
API Reference: http://localhost:4000/api/reference
```

## 9. Try it out

### Browse the API docs

Open [http://localhost:4000/api/reference](http://localhost:4000/api/reference) in your browser. You'll see the full interactive Scalar API reference with all endpoints.

### Chat with the weather agent (streaming)

```bash
curl -N -X POST http://localhost:4000/api/agents/weather \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?"}'
```

You'll see SSE events streaming back:

```
event: session:start
data: {"conversationId":"conv_1234_abc"}

event: text-delta
data: {"text":"Let me check"}
...
```

### Chat with JSON response

```bash
curl -X POST "http://localhost:4000/api/agents/weather?format=json" \
  -H "Content-Type: application/json" \
  -d '{"message": "Weather in Paris?"}'
```

### Continue a conversation

Use the `conversationId` from the first response:

```bash
curl -N -X POST http://localhost:4000/api/agents/weather \
  -H "Content-Type: application/json" \
  -d '{"message": "How about New York?", "conversationId": "conv_1234_abc"}'
```

### Call a tool directly

```bash
curl -X POST http://localhost:4000/api/tools/getWeather \
  -H "Content-Type: application/json" \
  -d '{"input": {"location": "London"}}'
```

### List agents and tools

```bash
curl http://localhost:4000/api/agents
curl http://localhost:4000/api/tools
```

### View conversation history

```bash
# List all conversations
curl http://localhost:4000/api/conversations

# View a specific conversation
curl http://localhost:4000/api/conversations/conv_1234_abc
```

### Health check

```bash
curl http://localhost:4000/api/health
```

## 10. Add more components

Browse what's available and install more:

```bash
bunx @kitnai/cli list

# Install more components
bunx @kitnai/cli add calculator-tool
bunx @kitnai/cli add echo-tool

# Check what you have installed
bunx @kitnai/cli list --installed

# See details about a component
bunx @kitnai/cli info weather-agent

# Check for updates
bunx @kitnai/cli diff weather-agent
```

After installing new tools, register them in `src/index.ts` following the same pattern as the weather tool, then add them to an agent's tool set.

## What kitn gives you

When you mount the plugin with `app.route("/api", plugin.router)`, you get these routes automatically:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/agents` | List all agents |
| `POST /api/agents/:name` | Chat with an agent (SSE or JSON) |
| `GET /api/agents/:name` | Agent details and system prompt |
| `PATCH /api/agents/:name` | Update agent system prompt |
| `GET /api/tools` | List all tools |
| `POST /api/tools/:name` | Execute a tool directly |
| `GET /api/conversations` | List conversations |
| `GET /api/conversations/:id` | View conversation messages |
| `POST /api/conversations` | Create a conversation |
| `DELETE /api/conversations/:id` | Delete a conversation |
| `GET /api/memory/:namespace` | List memories |
| `POST /api/memory/:namespace` | Save a memory |
| `GET /api/skills` | List skills |
| `POST /api/skills` | Create a skill |
| `GET /api/reference` | Scalar API docs |
| `GET /api/doc` | OpenAPI JSON spec |

## Next steps

- **Add file storage** to persist conversations across restarts:
  ```typescript
  import { createAIPlugin, createFileStorage } from "@kitn/routes";

  const plugin = createAIPlugin({
    getModel: (id) => openrouter(id ?? MODEL),
    storage: createFileStorage({ dataDir: "./data" }),
  });
  ```

- **Add an orchestrator** to automatically route queries across multiple agents:
  ```typescript
  plugin.createOrchestrator({
    name: "orchestrator",
    description: "Routes queries to specialist agents",
    autonomous: true,
  });
  ```

- **Add voice** support for speech-to-text and text-to-speech (requires OpenAI API key)

- **Build a frontend** using `@kitn/client` for SSE parsing, audio recording, and TTS playback
