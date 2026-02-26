# Using kitn Components

This guide covers how to use components installed via `kitn add` in your project.

## What `kitn add` Gives You

When you run `kitn add weather-agent`, the CLI:

1. **Fetches** the component and its `registryDependencies` from the registry
2. **Resolves** the full dependency graph (transitive, deduplicated, topologically sorted)
3. **Copies source files** directly into your project under the configured alias directories
4. **Installs npm packages** listed in `dependencies`/`devDependencies`
5. **Handles environment variables** — writes missing vars to `.env.example`, prompts you to enter values for `.env`
6. **Tracks** installed files in `kitn.json` under `installed`

The key concept: **you own the code**. Components are copied as source files, not imported as packages. You can modify them freely.

### Default file layout

After `kitn init`, your project has this alias configuration in `kitn.json`:

```json
{
  "aliases": {
    "agents": "src/agents",
    "tools": "src/tools",
    "skills": "src/skills",
    "storage": "src/storage"
  }
}
```

Running `kitn add weather-agent` (which depends on `weather-tool`) creates:

```
src/
  agents/
    weather-agent.ts    # Agent config with system prompt + tool bindings
  tools/
    weather.ts          # AI SDK tool implementation
```

## Server Setup

All components are registered with an `AIPluginInstance` created by `createAIPlugin`. Here's the overall wiring order:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAIPlugin, createFileStorage } from "@kitnai/hono";
import { openrouter } from "@openrouter/ai-sdk-provider";

// 1. Create the plugin
const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? "openai/gpt-4o-mini"),
  storage: createFileStorage({ dataDir: "./data" }),
  resilience: { maxRetries: 2, baseDelayMs: 500 },
  compaction: { threshold: 20, preserveRecent: 4 },
});

// 2. Register tools (before agents that use them)
// 3. Register agents
// 4. Create orchestrator (optional)

// 5. Mount and start
const app = new Hono();
app.use("/*", cors());
app.route("/api", plugin.app);
await plugin.initialize();

export default { port: 4000, fetch: app.fetch };
```

The `createAIPlugin` config options:

| Field | Required | Description |
|-------|----------|-------------|
| `getModel` | Yes | Factory function returning a Vercel AI SDK `LanguageModel` |
| `storage` | No | Storage provider. Defaults to ephemeral in-memory storage. |
| `resilience` | No | Retry config: `maxRetries`, `baseDelayMs`, `maxDelayMs`, `jitterFactor`, `onFallback` |
| `compaction` | No | Auto-summarize long conversations: `threshold` (default 20), `preserveRecent` (default 4) |
| `maxDelegationDepth` | No | Max depth for orchestrator delegation chains (default 3) |
| `defaultMaxSteps` | No | Max AI SDK tool-call steps per request (default 5) |
| `memoryStore` | No | Override the backing store for the built-in `_memory` tool |
| `voice` | No | Enable voice routes: `{ retainAudio?: boolean }` |

---

## Registering Tools

Tools are registered via `plugin.tools.register()`. Each tool wraps a [Vercel AI SDK `tool()`](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling) and makes it available both to agents and as a direct API endpoint.

### ToolRegistration interface

```ts
interface ToolRegistration {
  name: string;                                // Unique identifier (e.g. "getWeather")
  description: string;                         // Human-readable description
  inputSchema: z.ZodType<any>;                 // Zod schema for inputs (used in OpenAPI docs)
  tool: any;                                   // AI SDK tool object from tool()
  directExecute?: (input: any) => Promise<any>;// Enable POST /tools/:name direct calls
  category?: string;                           // Grouping label (e.g. "weather", "utility")
  examples?: ToolExample[];                    // Example inputs for prompt engineering
}

interface ToolExample {
  name?: string;                               // E.g. "Basic lookup"
  input: Record<string, unknown>;              // Example input object
  description?: string;                        // Why this example matters
}
```

### Example: Registering the weather tool

```ts
import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono";

// The AI SDK tool (used by agents during generation)
export const weatherTool = tool({
  description: "Get current weather for a location.",
  inputSchema: z.object({
    location: z.string().describe("City name, e.g. 'Tokyo'"),
  }),
  execute: async ({ location }) => {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?...`);
    return res.json();
  },
});

// Register with the plugin
export function registerWeatherTool(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "getWeather",
    description: "Get current weather information for a location",
    inputSchema: z.object({ location: z.string() }),
    tool: weatherTool,

    // directExecute enables POST /api/tools/getWeather
    directExecute: async (input) =>
      weatherTool.execute!(
        { location: input.location },
        { toolCallId: "direct" } as any,
      ),

    category: "weather",

    examples: [
      { name: "City lookup", input: { location: "Tokyo" } },
      { name: "Full name", input: { location: "New York, NY" } },
    ],
  });
}
```

### ToolRegistry methods

```ts
plugin.tools.register(registration)           // Add a tool
plugin.tools.get("getWeather")                // Get by name (or undefined)
plugin.tools.list()                           // All registered tools
plugin.tools.execute("getWeather", { location: "Tokyo" })  // Direct execution
```

After registration, the tool is available at:
- `GET /api/tools` — listed in the tool index
- `POST /api/tools/getWeather` — direct execution (if `directExecute` is provided)

---

## Registering Agents

Agents are registered via `plugin.agents.register()`. Each agent has a system prompt, a set of tools, and SSE/JSON request handlers.

### AgentRegistration interface

```ts
interface AgentRegistration {
  name: string;                    // Unique identifier (e.g. "weather")
  description: string;             // Shown to the orchestrator when routing
  toolNames: string[];             // Declarative list of tool names
  defaultFormat: "json" | "sse";   // Default response format
  defaultSystem: string;           // System prompt (overridable at runtime via API)
  tools?: Record<string, any>;     // AI SDK tool objects keyed by name
  sseHandler?: AgentHandler;       // Handler for SSE streaming requests
  jsonHandler?: AgentHandler;      // Handler for JSON requests
  tags?: string[];                 // Optional taxonomy tags
  disableMemoryTool?: boolean;     // Opt out of the auto-injected memory tool
  actions?: ActionRegistration[];  // Custom sub-routes under the agent
  guard?: (query: string, agent: string) => GuardResult | Promise<GuardResult>;
}

interface GuardResult {
  allowed: boolean;
  reason?: string;
}
```

### Example: Registering the weather agent

Registry agents export a config object. You wire them into the server by creating handlers and registering:

```ts
import type { AIPluginInstance } from "@kitnai/hono";
import { WEATHER_AGENT_CONFIG } from "./agents/weather-agent.js";

export function registerWeatherAgent(plugin: AIPluginInstance) {
  const tools = WEATHER_AGENT_CONFIG.tools;

  // createHandlers() builds SSE + JSON handler pair pre-wired with tools
  const { sseHandler, jsonHandler } = plugin.createHandlers({
    tools,
    maxSteps: 5, // optional, defaults to plugin's defaultMaxSteps
  });

  plugin.agents.register({
    name: "weather",
    description: "Weather specialist — fetches and presents weather data",
    toolNames: Object.keys(tools),
    defaultFormat: "sse",
    defaultSystem: WEATHER_AGENT_CONFIG.system,
    tools,
    sseHandler,
    jsonHandler,
  });
}
```

After registration, the agent is available at:
- `GET /api/agents` — listed in the agent index
- `GET /api/agents/weather` — agent details
- `POST /api/agents/weather` — chat (SSE by default, JSON with `Accept: application/json`)

### Adding a guard

Guards run before every request to an agent. If `allowed` is `false`, the request is rejected with the `reason`:

```ts
plugin.agents.register({
  name: "moderated",
  description: "Agent with content moderation",
  toolNames: ["echo"],
  defaultFormat: "sse",
  defaultSystem: "You are a helpful assistant.",
  tools,
  sseHandler,
  jsonHandler,
  guard: async (query, agentName) => {
    if (query.toLowerCase().includes("blocked")) {
      return { allowed: false, reason: "Content policy violation" };
    }
    return { allowed: true };
  },
});
```

### Adding custom actions

Actions mount additional endpoints under an agent:

```ts
plugin.agents.register({
  // ... standard fields ...
  actions: [
    {
      name: "export",
      method: "get",
      summary: "Export agent history",
      description: "Returns all conversations for this agent as JSON",
      handler: async (c) => c.json({ history: [] }),
    },
  ],
});
// Creates: GET /api/agents/weather/export
```

### AgentRegistry methods

```ts
plugin.agents.register(registration)             // Add an agent
plugin.agents.get("weather")                     // Get by name (or undefined)
plugin.agents.list()                             // All registered agents
plugin.agents.getResolvedPrompt("weather")       // Current prompt (override or default)
plugin.agents.setPromptOverride("weather", "...") // Override system prompt at runtime
plugin.agents.resetPrompt("weather")             // Revert to defaultSystem
```

---

## Creating an Orchestrator

An orchestrator is a special agent that routes queries to other agents. It's created via `plugin.createOrchestrator()` which auto-registers itself — no separate `.register()` call needed.

### OrchestratorAgentConfig

```ts
interface OrchestratorAgentConfig {
  name: string;           // Agent name (e.g. "orchestrator")
  description?: string;   // Defaults to a routing description
  systemPrompt?: string;  // Custom system prompt (defaults to built-in routing instructions)
  agents?: string[];      // Restrict which agents can be routed to (omit for all)
  autonomous?: boolean;   // true = execute immediately, false = propose plan for approval
}
```

### Example

```ts
// Routes to all registered agents autonomously
plugin.createOrchestrator({
  name: "orchestrator",
  description: "Routes queries to specialist agents",
  autonomous: true,
});
```

```ts
// Restrict routing to specific agents, require approval
plugin.createOrchestrator({
  name: "supervisor",
  description: "Supervised routing with approval",
  agents: ["weather", "search"],
  autonomous: false,
});
```

The orchestrator gets two built-in tools:
- **`routeToAgent`**: Delegates a single query to a named agent synchronously
- **`createTask`**: Declares parallel tasks across multiple agents

In `autonomous: false` mode, the orchestrator proposes a plan and waits for the client to send `approvedPlan` before executing.

After creation, the orchestrator is available at `POST /api/agents/orchestrator` like any other agent.

---

## Using Skills

Skills are Markdown instruction documents with YAML frontmatter. They're stored in the skill store and injected into agent system prompts by the orchestrator at runtime.

### Skill file format

```markdown
---
name: eli5
description: Use when the user asks to explain something simply
tags: [simple, explanation, beginner]
phase: response
---

# Explain Like I'm 5

## Instructions
1. Use everyday analogies
2. Avoid jargon completely
3. Start with the big picture
```

The `phase` controls when the skill is injected:
- **`query`**: Appended to the agent's system prompt before processing
- **`response`**: Injected into the orchestrator's synthesis prompt when assembling the final answer
- **`both`**: Applied at both stages

### Loading skills into the server

After `kitn add eli5`, the file lands at `src/skills/README.md`. Skills are managed through the REST API — the server's skill store handles persistence:

```ts
// Create a skill via the API
const res = await fetch("http://localhost:4000/api/skills", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": "your-key" },
  body: JSON.stringify({
    name: "eli5",
    content: `---
name: eli5
description: Use when the user asks to explain something simply
tags: [simple, explanation, beginner]
phase: response
---

# Explain Like I'm 5
...`,
  }),
});
```

Or load skills programmatically at startup:

```ts
import { readFileSync } from "fs";

const skillContent = readFileSync("./src/skills/README.md", "utf-8");

// After plugin.initialize(), use the storage directly
await plugin.app.storage?.skills.createSkill("eli5", skillContent);
```

If you're using `createFileStorage({ dataDir: "./data" })`, you can also place skill files directly in `data/skills/<name>/README.md` — they'll be available immediately.

### Skills API endpoints

```
GET    /api/skills            — List all skills (returns name, description, tags, phase)
GET    /api/skills/:name      — Get full skill content
POST   /api/skills            — Create: { name: string, content: string }
PUT    /api/skills/:name      — Update: { content: string }
DELETE /api/skills/:name      — Delete a skill
```

### How skills flow through the system

1. The orchestrator's system prompt includes a summary of all available skills
2. When routing to an agent, the orchestrator can pass skill names in its `routeToAgent` or `createTask` tool calls
3. Skills with `phase: "query"` or `"both"` are appended to the target agent's system prompt
4. Skills with `phase: "response"` or `"both"` are injected into the orchestrator's synthesis prompt when assembling the final answer

---

## Using Storage Adapters

Storage adapters provide persistence for conversations, memory, skills, tasks, prompts, and audio. The server requires a `StorageProvider` that bundles all six stores.

### StorageProvider interface

```ts
interface StorageProvider {
  conversations: ConversationStore;   // Chat history
  memory: MemoryStore;                // Key-value namespaced memory
  skills: SkillStore;                 // Behavioral instruction documents
  tasks: TaskStore;                   // Orchestrator task tracking
  prompts: PromptStore;              // Agent prompt overrides
  audio: AudioStore;                  // Voice audio files
}
```

### Built-in storage options

```ts
import { createFileStorage, createMemoryStorage } from "@kitnai/hono";

// File-based (persistent) — stores JSON files under dataDir/
const storage = createFileStorage({ dataDir: "./data" });

// In-memory (ephemeral) — used by default if no storage is provided
const storage = createMemoryStorage();
```

The file storage creates this structure:

```
data/
  conversations/    # One JSON file per conversation
  memory/           # Namespaced key-value entries
  skills/           # One subdirectory per skill with README.md
  tasks/            # Task records
  audio/            # Binary audio files
  prompt-overrides.json
```

### Using a registry storage component

After `kitn add conversation-store`, you get a standalone conversation store implementation:

```ts
import { createConversationStore } from "./storage/conversation-store.js";

const conversations = createConversationStore("./data");

// Use it in a custom StorageProvider
const plugin = createAIPlugin({
  getModel,
  storage: {
    conversations,
    memory: myMemoryStore,
    skills: mySkillStore,
    tasks: myTaskStore,
    prompts: myPromptStore,
    audio: myAudioStore,
  },
});
```

### ConversationStore interface

```ts
interface ConversationStore {
  get(id: string): Promise<Conversation | null>;
  list(): Promise<ConversationSummary[]>;
  create(id: string): Promise<Conversation>;
  append(id: string, message: ConversationMessage): Promise<Conversation>;
  delete(id: string): Promise<boolean>;
  clear(id: string): Promise<Conversation>;    // Removes all messages, keeps the record
}
```

### MemoryStore interface

```ts
interface MemoryStore {
  listNamespaces(): Promise<string[]>;
  listEntries(namespace: string): Promise<MemoryEntry[]>;
  saveEntry(namespace: string, key: string, value: string): Promise<MemoryEntry>;
  getEntry(namespace: string, key: string): Promise<MemoryEntry | null>;
  deleteEntry(namespace: string, key: string): Promise<boolean>;
  clearNamespace(namespace: string): Promise<void>;
  loadMemoriesForIds(namespaces: string[]): Promise<string>;
}
```

The memory store is also exposed as a built-in tool that agents can call. Each agent gets its own namespace by default.

---

## Card Extractors

Card extractors transform tool results into structured UI data. They're optional and used by frontends to render rich cards (e.g., weather cards, recipe cards).

```ts
import type { AIPluginInstance } from "@kitnai/hono";

plugin.cards.register((toolName, result) => {
  if (toolName === "getWeather" && result?.temperature) {
    return {
      type: "weather",
      data: {
        location: result.location,
        temperature: result.temperature,
        description: result.description,
      },
    };
  }
  return null; // Return null for non-matching tools
});
```

---

## Dependency Resolution

The CLI resolves `registryDependencies` transitively. For example:

```
weather-agent
  └── weather-tool (registryDependency)
```

Running `kitn add weather-agent` installs both. The resolver:

1. Fetches each requested component from the registry
2. Recursively fetches all `registryDependencies`
3. Deduplicates (each component installed once)
4. Topologically sorts using Kahn's algorithm (dependencies first)
5. Detects and rejects circular dependencies

npm dependencies (`dependencies` field) are also collected and installed via your detected package manager (bun/pnpm/yarn/npm).

## Updating and Diffing

```bash
kitn diff weather-agent    # Show local vs registry differences
kitn update weather-agent  # Re-fetch from registry (prompts on conflicts)
kitn remove weather-agent  # Delete files and remove from kitn.json
```

## Full Example

See [`examples/getting-started/`](../../examples/getting-started/) for a complete working project with a weather agent, weather tool, and Hono server.
