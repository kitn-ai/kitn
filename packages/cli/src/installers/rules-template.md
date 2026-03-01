# kitn AI Agent Framework

This project uses **kitn** to build multi-agent AI systems.

## Project Structure

AI components live under `{base}`:

- `{agents}/` — Agent definitions (one file per agent)
- `{tools}/` — Tool definitions (one file per tool)
- `{skills}/` — Skill files (markdown with YAML frontmatter)
- `{storage}/` — Custom storage providers
- `{crons}/` — Cron job definitions

Entry point: `{base}/plugin.ts` — creates the plugin and wires everything together.

## kitn.json Reference

The project config file at the root:

```json
{
  "$schema": "https://kitn.dev/schema/config.json",
  "runtime": "node",
  "framework": "hono",
  "aliases": {
    "base": "src/ai",
    "agents": "src/ai/agents",
    "tools": "src/ai/tools",
    "skills": "src/ai/skills",
    "storage": "src/ai/storage",
    "crons": "src/ai/crons"
  },
  "registries": {
    "@kitn": {
      "url": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
      "homepage": "https://kitn.ai",
      "description": "Official kitn AI agent components"
    }
  }
}
```

Fields:
- `runtime` — `"node"`, `"bun"`, or `"deno"`
- `framework` — `"hono"`, `"hono-openapi"`, `"elysia"`, `"cloudflare"`, `"fastify"`, or `"express"`
- `aliases` — where CLI installs components. `base` is the parent directory (default `src/ai`). Each component type maps to a subdirectory.
- `registries` — named registries for `kitn add`. Each has a `url` template with `{type}/{name}.json` placeholders. Can be a string URL or an object with `url`, `homepage`, `description`. Users may have private registries (e.g. `@myteam`).
- `chatService` — optional `{ url: string }` for custom `kitn chat` endpoint

The `kitn.lock` file (auto-managed) tracks installed components with their version, files, hash, and registry source.

## Import Conventions

- `@kitn/core` — framework types and utilities (`registerAgent`, `registerTool`, `registerWithPlugin`, storage factories)
- `@kitn/adapters/hono` — Hono adapter (`createAIPlugin`)
- `ai` — Vercel AI SDK v6 (`tool()` function). Uses `inputSchema` not `parameters`, `toolCall.input` not `toolCall.args`
- `zod` — schema definitions for tool inputs
- Always use `.js` extension in relative imports (TypeScript compiles to JS)

## Defining Tools

Tools use Vercel AI SDK v6 `tool()` with `inputSchema` (not `parameters`).

File: `{tools}/weather.ts`

```ts
import { tool } from "ai";
import { z } from "zod";
import { registerTool } from "@kitn/core";

const weatherTool = tool({
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name or coordinates"),
  }),
  execute: async ({ location }) => {
    const res = await fetch(`https://api.weather.example/${location}`);
    return res.json();
  },
});

registerTool({
  name: "weather",
  description: "Get current weather for a location",
  inputSchema: z.object({ location: z.string() }),
  tool: weatherTool,
  directExecute: async ({ location }) => {
    const res = await fetch(`https://api.weather.example/${location}`);
    return res.json();
  },
  category: "data",
});

export { weatherTool };
```

Key points:
- `inputSchema` uses Zod — use `.describe()` on each field for better AI understanding
- `directExecute` enables the REST endpoint `POST /tools/:name/execute`
- `category` is optional, for grouping in the UI
- The `tool` field holds the Vercel AI SDK tool object used during agent execution

## Defining Agents

File: `{agents}/assistant.ts`

```ts
import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";
import { calculatorTool } from "../tools/calculator.js";

registerAgent({
  name: "assistant",
  description: "General-purpose assistant with weather and math capabilities",
  system: `You are a helpful assistant. Use your tools when the user asks
about weather or needs calculations. Be concise and accurate.`,
  tools: {
    weather: weatherTool,
    calculator: calculatorTool,
  },
});
```

Key points:
- `tools` is a `Record<string, ToolObject>` — keys are tool names, values are AI SDK tool objects
- `system` is the system prompt injected into every conversation
- `description` is used by the orchestrator for routing decisions
- Default format is `"sse"` (streaming); set `format: "json"` for non-streaming

## Wiring Tools to Agents

Tools are wired to agents via the `tools` map — a plain object where keys are tool names and values are AI SDK `tool()` objects:

```ts
registerAgent({
  name: "my-agent",
  system: "...",
  description: "...",
  tools: {
    toolName: toolObject,    // key = name the agent sees, value = tool() result
    anotherTool: anotherToolObject,
  },
});
```

You can also wire tools via CLI: `kitn link tool weather --to assistant`

## How Agent Execution Works

When an agent is invoked (`POST /agents/:name`), the framework:

1. Loads conversation history from `ConversationStore` (if `conversationId` provided)
2. Runs auto-compaction if messages exceed threshold (summarizes old messages, preserves recent)
3. Resolves the system prompt (checks for runtime overrides via `PromptStore`)
4. Loads memory context from `MemoryStore` and appends to system prompt
5. Injects built-in tools (`_memory`, `_clarify`) alongside the agent's registered tools
6. Runs the agent's guard (if present) — blocks execution if `{ allowed: false }`
7. Calls AI SDK `streamText` (SSE) or `generateText` (JSON) with `stopWhen: stepCountIs(maxSteps)`
8. The model calls tools in a loop until it produces a final text response or hits `maxSteps` (default: 5)
9. Wraps the LLM call with resilience (retries with exponential backoff on transient errors)
10. Persists the assistant response to `ConversationStore`
11. Emits lifecycle hooks (`agent:start`, `agent:end`, `tool:execute`, etc.)

SSE events emitted in order: `session:start`, `status`, `text-delta` (streaming chunks), `tool-call`, `tool-result`, `done`.

## Guards

Add a `guard` to an agent to filter or block requests before execution:

```ts
plugin.agents.register({
  ...agentConfig,
  guard: async (query, agentName) => {
    if (containsBlockedContent(query)) {
      return { allowed: false, reason: "Request contains blocked content" };
    }
    return { allowed: true };
  },
});
```

The guard receives the user's query and the agent name. Return `{ allowed: false, reason: "..." }` to block execution.

## Skills

Skills are markdown files with YAML frontmatter that modify agent behavior at runtime.

File: `{skills}/formal-tone.md`

```markdown
---
name: formal-tone
description: Makes the agent respond in a formal, professional tone
tags: [tone, professional]
phase: response
---

Respond in a formal, professional tone. Use complete sentences, avoid contractions.
```

Fields:
- `name` — kebab-case identifier
- `description` — what the skill does (shown to orchestrator for routing)
- `tags` — for filtering and discovery
- `phase` — `"query"` (injected before processing), `"response"` (shapes output), or `"both"`

Skills are activated by the orchestrator when routing queries to agents. The orchestrator sees skill summaries and can pass `skills: ["formal-tone"]` when routing to inject skill content into the agent's system prompt.

## Orchestrator

Multi-agent routing — automatically discovers registered agents and routes queries to the best match:

```ts
plugin.createOrchestrator({
  name: "orchestrator",
  description: "Routes queries to specialist agents",
  autonomous: true,
});
```

The orchestrator gets two built-in tools:

- **`routeToAgent`** — immediate single-agent delegation. Used for simple, single-domain queries. Returns the agent's response synchronously within the tool call.
- **`createTask`** — creates parallel sub-tasks. Used for complex, multi-domain queries. All tasks run in parallel via `Promise.allSettled`, results are synthesized.

Configuration options:
- `autonomous: true` (default) — executes immediately. `false` — returns a plan for user approval before executing.
- `agents: ["weather", "assistant"]` — whitelist specific agents. Omit to auto-discover all registered non-orchestrator agents.
- `systemPrompt` — override the default routing prompt.

### Delegation depth

Agents delegate through `executeTask()`. A `DelegationContext` tracks the call chain:
- Maximum depth: `maxDelegationDepth` (default: 3) in plugin config
- Self-delegation is blocked (agent can't route to itself)
- Circular delegation is blocked (agent A → B → A)

### Plan mode

Send `planMode: true` in the request body — the orchestrator only collects `createTask` calls without executing. Returns the plan with `awaitingApproval: true`. Re-submit with `approvedPlan` to execute.

## Human-in-the-Loop

Create tools **without `execute` functions** — they become proposal tools. The AI calls them (tool call is captured in the response), but nothing executes automatically. The client receives the tool call data and can execute the action after human approval.

```ts
const proposalTools = {
  sendEmail: tool({
    description: "Propose sending an email",
    inputSchema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    // NO execute — proposal only, client handles execution after approval
  }),
};
```

The built-in `_clarify` tool (auto-injected into every agent) can also surface questions to the user. It supports item types: `"question"`, `"option"`, `"confirmation"`, `"action"`, `"warning"`, `"info"`. When clarification is needed, the response includes `awaitingResponse: true` and the client re-submits with answers.

A pre-built `human-in-loop-agent` is available in the registry: `kitn add human-in-loop-agent`

## Memory

Every agent automatically gets a `_memory` tool for persistent key-value storage across conversations:
- `set` — save a key-value pair (with optional context note)
- `get` — retrieve a value by key
- `list` — show all stored entries
- `delete` — remove an entry

Memory is namespaced per agent by default. The agent can specify a different `namespace` to share memory across agents. Disable per-agent with `disableMemoryTool: true` on the agent registration.

Memory context is loaded at the start of each conversation turn and injected into the system prompt under `## Memory Context`.

The `MemoryStore` interface supports:
- `saveEntry(namespace, key, value, context?)` — upsert a key-value pair
- `getEntry(namespace, key)` — retrieve by key
- `listEntries(namespace)` — all entries in a namespace
- `deleteEntry(namespace, key)` — remove an entry
- `listNamespaces()` — all namespace names
- `clearNamespace(namespace)` — delete all entries in a namespace
- `loadMemoriesForIds(namespaceIds)` — bulk load across namespaces

## Prompts (Runtime Overrides)

Agent system prompts can be overridden at runtime without redeploying code:

- `PATCH /agents/:name` with `{ system: "new prompt" }` — overrides the system prompt
- `PATCH /agents/:name` with `{ reset: true }` — reverts to the default

Overrides are persisted in `PromptStore` and survive server restarts. The `PromptStore` interface:

```ts
interface PromptStore {
  loadOverrides(): Promise<Record<string, { prompt: string; updatedAt: string }>>;
  saveOverride(name: string, prompt: string): Promise<{ prompt: string; updatedAt: string }>;
  deleteOverride(name: string): Promise<boolean>;
}
```

## Commands (Runtime-Defined Agents)

Commands are agent configurations stored as data (not compiled code) — created at runtime via the API:

- `POST /commands` — create/update a command with `{ name, description, system, tools?, model?, format? }`
- `POST /commands/:name/run` — execute like an agent (resolves tool names from the tool registry)

Unlike registered agents (which are TypeScript code), commands can be created dynamically without redeploying. The `tools` field is an array of tool name strings (referencing already-registered tools), not tool objects.

## Auto-Registration

Components use a queue-and-flush pattern:

1. Each file calls `registerAgent()` / `registerTool()` at module load time (queues, doesn't execute)
2. After creating the plugin, call `registerWithPlugin(plugin)` to flush the queue

File: `{base}/plugin.ts`

```ts
import { registerWithPlugin, createFileStorage } from "@kitn/core";
import { createAIPlugin } from "@kitn/adapters/hono";

// Import components — triggers registerAgent/registerTool calls
import "./agents/assistant.js";
import "./tools/weather.js";
import "./tools/calculator.js";

const plugin = createAIPlugin({
  model: (id) => yourModelProvider(id ?? "default-model"),
  storage: createFileStorage({ dataDir: "./data" }),
});

// Flush all queued registrations into the plugin
await registerWithPlugin(plugin);

export { plugin };
```

## Plugin Configuration

```ts
import { createAIPlugin } from "@kitn/adapters/hono";
import { createFileStorage } from "@kitn/core";

const plugin = createAIPlugin({
  // Required: model factory — receives optional model ID override
  model: (id) => yourProvider(id ?? "default-model"),

  // Storage (defaults to in-memory if omitted)
  storage: createFileStorage({ dataDir: "./data" }),

  // Retry on transient LLM errors (429, 500, 502, 503, 504, timeouts)
  resilience: {
    maxRetries: 3,        // default: 3
    baseDelayMs: 1000,    // default: 1000ms, exponential backoff with jitter
    onFallback: ({ currentModel, error }) => "fallback-model-id",  // optional
  },

  // Auto-summarize long conversations
  compaction: {
    threshold: 20,        // compact when messages exceed this count
    preserveRecent: 4,    // keep last N messages verbatim, summarize the rest
  },

  // Lifecycle event hooks
  hooks: { level: "summary" },  // "summary" or "trace"

  // Agent execution limits
  maxDelegationDepth: 3,  // max orchestrator → agent nesting depth
  defaultMaxSteps: 5,     // max tool-call loops per agent invocation

  // Cron scheduling (opt-in — enables /crons routes)
  cronScheduler: myScheduler,

  // Serverless keep-alive (Vercel, Cloudflare)
  waitUntil: (promise) => ctx.waitUntil(promise),

  // Additional plugins (voice, etc.)
  plugins: [],
});
```

Mount on your Hono server: `app.route("/api", plugin.router)`

## Storage

Two built-in providers:
- `createFileStorage({ dataDir: "./data" })` — persistent JSON files on disk
- `createMemoryStorage()` — ephemeral in-memory (default)

### StorageProvider structure

```ts
interface StorageProvider {
  conversations: ConversationStore;  // chat history
  memory: MemoryStore;              // agent key-value memory
  skills: SkillStore;               // behavioral skills
  tasks: TaskStore;                 // kanban task board
  prompts: PromptStore;             // system prompt overrides
  commands: CommandStore;            // runtime-defined agents
  crons: CronStore;                 // scheduled jobs
  jobs: JobStore;                   // background job tracking
}
```

### Mix-and-match

Each sub-store is independent. You can back any store with any backend:

```ts
const storage: StorageProvider = {
  conversations: myPostgresStore,
  memory: myRedisStore,
  skills: createFileStorage({ dataDir: "./data" }).skills,
  tasks: createMemoryStorage().tasks,
  prompts: createMemoryStorage().prompts,
  commands: createMemoryStorage().commands,
  crons: createMemoryStorage().crons,
  jobs: createMemoryStorage().jobs,
};
```

### Implementing a custom store

Implement the interface for the sub-store you want to customize. Each method signature includes an optional `scopeId` parameter for multi-tenancy.

**ConversationStore** — the most commonly customized:

```ts
interface ConversationStore {
  get(id: string, scopeId?: string): Promise<Conversation | null>;
  list(scopeId?: string): Promise<ConversationSummary[]>;
  create(id: string, scopeId?: string): Promise<Conversation>;
  append(id: string, message: ConversationMessage, scopeId?: string): Promise<Conversation>;
  delete(id: string, scopeId?: string): Promise<boolean>;
  clear(id: string, scopeId?: string): Promise<Conversation>;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

**CronStore** — for persistent scheduling:

```ts
interface CronStore {
  create(input: Omit<CronJob, "id" | "createdAt" | "updatedAt">, scopeId?: string): Promise<CronJob>;
  get(id: string, scopeId?: string): Promise<CronJob | null>;
  list(scopeId?: string): Promise<CronJob[]>;
  update(id: string, updates: Partial<Omit<CronJob, "id" | "createdAt">>, scopeId?: string): Promise<CronJob>;
  delete(id: string, scopeId?: string): Promise<boolean>;
  addExecution(input: Omit<CronExecution, "id">, scopeId?: string): Promise<CronExecution>;
  listExecutions(cronId: string, limit?: number, scopeId?: string): Promise<CronExecution[]>;
  updateExecution(id: string, updates: Partial<CronExecution>, scopeId?: string): Promise<CronExecution>;
  getDueJobs(now: Date, scopeId?: string): Promise<CronJob[]>;
}
```

**JobStore** — for background job persistence:

```ts
interface JobStore {
  create(job: Omit<Job, "id" | "createdAt">): Promise<Job>;
  get(id: string, scopeId?: string): Promise<Job | null>;
  list(scopeId?: string): Promise<Job[]>;
  update(id: string, updates: Partial<Omit<Job, "id">>): Promise<Job>;
  delete(id: string, scopeId?: string): Promise<boolean>;
}
```

**TaskStore:**

```ts
interface TaskStore {
  createTask(title: string): Promise<Task>;
  listTasks(): Promise<Task[]>;
  updateTask(id: string, updates: { title?: string; status?: "todo" | "in-progress" | "done" }): Promise<Task>;
  deleteTask(id: string): Promise<boolean>;
}
```

**CommandStore:**

```ts
interface CommandStore {
  list(scopeId?: string): Promise<CommandRegistration[]>;
  get(name: string, scopeId?: string): Promise<CommandRegistration | undefined>;
  save(command: CommandRegistration, scopeId?: string): Promise<void>;
  delete(name: string, scopeId?: string): Promise<void>;
}
```

**SkillStore:**

```ts
interface SkillStore {
  listSkills(): Promise<SkillMeta[]>;
  getSkill(name: string): Promise<Skill | null>;
  createSkill(name: string, content: string): Promise<Skill>;
  updateSkill(name: string, content: string): Promise<Skill>;
  deleteSkill(name: string): Promise<boolean>;
  getSkillSummaries(): Promise<string>;
}
```

Use the built-in file or memory implementations as reference when building custom stores.

## Crons

Opt-in scheduled agent execution. Enable by providing a `cronScheduler` in plugin config:

```ts
const plugin = createAIPlugin({
  model: (id) => yourProvider(id ?? "default-model"),
  cronScheduler: myScheduler,  // enables /crons API routes
});
```

### CronScheduler interface

```ts
interface CronScheduler {
  schedule(job: CronJob, callbackUrl: string): Promise<void>;
  unschedule(jobId: string): Promise<void>;
  update?(job: CronJob, callbackUrl: string): Promise<void>;
}
```

### Built-in InternalScheduler

For long-running servers, use the built-in scheduler:

```ts
import { createInternalScheduler } from "@kitn/core";

const scheduler = createInternalScheduler(plugin, {
  interval: 60_000,  // tick every 60s (default)
  onComplete: (job, execution) => console.log(`Done: ${job.name}`),
  onError: (job, error) => console.error(`Failed: ${job.name}`, error),
});
scheduler.start();
```

### External schedulers (registry components)

For serverless, install from the registry:
- `kitn add upstash-scheduler` — Upstash QStash HTTP callbacks
- `kitn add cloudflare-scheduler` — Cloudflare Workers cron triggers
- `kitn add vercel-scheduler` — Vercel Cron with CRON_SECRET verification
- `kitn add bullmq-scheduler` — Redis-backed BullMQ

### Cron manager agent

For natural language scheduling, install `kitn add cron-manager-agent` — it discovers registered agents and creates/manages cron jobs through conversation.

### Creating cron jobs

```ts
await plugin.storage.crons.create({
  name: "daily-digest",
  description: "Summarize news every morning",
  schedule: "0 6 * * *",
  agentName: "news-agent",
  input: "Summarize today's top stories",
  enabled: true,
  timezone: "America/New_York",
});
```

Use `runAt: "2026-03-01T09:00:00Z"` instead of `schedule` for one-off jobs.

### CronJob shape

```ts
interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule?: string;     // cron expression (mutually exclusive with runAt)
  runAt?: string;        // ISO datetime for one-off (mutually exclusive with schedule)
  agentName: string;     // registered agent to invoke
  input: string;         // message sent to agent
  model?: string;        // optional model override
  timezone?: string;     // IANA timezone, default UTC
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
  createdAt: string;
  updatedAt: string;
}
```

## Background Jobs

Opt-in async agent execution for long-running tasks:

```
POST /agents/:name?async=true
```

Returns HTTP 202 with `{ jobId, conversationId }`. The agent runs in the background.

### Reconnectable SSE

```
GET /jobs/:id/stream
```

Streams events for a background job. If the client disconnects and reconnects, all past events are replayed (catch-up) before switching to live events. Events: `text-delta`, `tool-call`, `tool-result`, `done`, `error`, `cancelled`.

### Job shape

```ts
interface Job {
  id: string;
  agentName: string;
  input: string;
  conversationId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolsUsed?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

For serverless platforms, configure `waitUntil` in plugin config to keep the function alive while the job runs.

## Voice

Voice is an opt-in package for text-to-speech, speech-to-text, and full voice conversations. Install from the registry:

```
kitn add voice
```

Configure with an OpenAI-compatible voice provider and add as a plugin:

```ts
import { createVoice } from "@kitn/voice";

const voice = createVoice({ /* provider config */ });
const plugin = createAIPlugin({
  model: (id) => yourProvider(id ?? "default-model"),
  plugins: [voice],
});
```

Voice routes are only mounted when the voice plugin is provided.

## MCP Integration

### Consuming external MCP servers (MCP client)

Install from the registry: `kitn add mcp-client`

Connect to external MCP servers and their tools become available to kitn agents:

```ts
import { connectMCPServers } from "@kitn/mcp-client";

const mcp = await connectMCPServers(plugin, {
  servers: [
    { name: "github", transport: { type: "http", url: "https://..." } },
    { name: "local", transport: { type: "stdio", command: "npx", args: ["-y", "@foo/mcp"] } },
  ],
});
// Tools registered as "github_toolName", "local_toolName", etc.
```

Transport types: `"http"`, `"sse"` (with optional `headers`), `"stdio"` (with `command` and `args`).

### Exposing kitn as an MCP server

Install from the registry: `kitn add mcp-server`

Expose kitn tools and agents to any MCP-compatible client:

```ts
import { createMCPServer } from "@kitn/mcp-server";

const mcp = createMCPServer(plugin, {
  name: "my-server",
  tools: ["weather"],           // which tools to expose
  agents: ["weather-agent"],    // agents exposed as "agent_<name>" tools
});
await mcp.connectStdio();
```

## Lifecycle Hooks

Subscribe to agent and system events for logging, monitoring, or analytics:

```ts
plugin.on("agent:start", (e) => console.log(`Agent ${e.agentName} started`));
plugin.on("agent:end", (e) => console.log(`Done in ${e.duration}ms`));
plugin.on("agent:error", (e) => console.error(`Error: ${e.error}`));
plugin.on("cron:executed", (e) => console.log(`Cron ${e.cronId}: ${e.status}`));
plugin.on("*", (e) => logger.info(e.type, e));
```

Enable with `hooks: { level: "summary" }` in plugin config.

**Summary level** events: `agent:start`, `agent:end`, `agent:error`, `job:start`, `job:end`, `job:cancelled`, `cron:executed`.

**Trace level** (set `level: "trace"`) adds: `tool:execute`, `delegate:start`, `delegate:end`, `model:call`.

## Component Registry

kitn uses a registry system for discovering and installing pre-built components. Components are source code copied into your project — you own the code and can modify it freely.

Component types: `kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage`, `kitn:package`, `kitn:cron`.

### Discovering registries

The public registry directory lists all known registries:

```
GET https://kitn-ai.github.io/registry/registries.json
```

Returns an array of `{ name, url, homepage, description }`. The default is `@kitn`.

### Browsing a registry's components

Each registry publishes an index of all its components:

```
GET https://kitn-ai.github.io/kitn/r/registry.json
```

The index URL is derived from the registry's URL template by replacing `{type}/{name}.json` with `registry.json`. Returns `{ items: [...] }` where each item has `name`, `type`, `description`, `registryDependencies`, `categories`, and `version`.

### Fetching a single component

Individual components are fetched by substituting into the registry URL template:

```
Template: https://kitn-ai.github.io/kitn/r/{type}/{name}.json
Example:  https://kitn-ai.github.io/kitn/r/agents/weather-agent.json
```

The `{type}` is the plural directory name (`agents`, `tools`, `skills`, `storage`, `package`, `crons`) and `{name}` is the component name. Returns full component details including `files` (source code), `dependencies`, `docs`, and `registryDependencies`.

### Project registries

The project's `kitn.json` lists registries under the `registries` key. Users may have private registries not listed in the public directory. When installing, specify the registry namespace: `kitn add @myteam/component-name`. Default namespace is `@kitn`.

### Finding examples

Registry components include full source code and documentation. Fetch a component's JSON to see its implementation. For example, to understand how to build a custom agent with guards, fetch the `guardrails-agent` component. To see orchestration patterns, fetch the `supervisor-agent`. Each component's `files` array contains the complete source, and `docs` contains usage instructions.

## CLI Commands

- `kitn add <name>` — install a component from the registry
- `kitn add @namespace/name` — install from a specific registry
- `kitn create <type> <name>` — scaffold a new component locally
- `kitn link tool <name> --to <agent>` — wire a tool to an agent
- `kitn list` — browse available registry components
- `kitn rules` — generate/update this rules file
- `kitn chat "<message>"` — AI-powered scaffolding assistant
- `kitn config set <key> <value>` — set user-level config (e.g. `chat-url`, `api-key`)

## API Endpoints

The plugin mounts these routes (prefix with your mount path, e.g. `/api`):

**Agents:**
- `POST /agents/:name` — invoke an agent (streaming SSE or JSON). Add `?async=true` for background execution.
- `GET /agents` — list registered agents
- `PATCH /agents/:name` — update system prompt override or reset to default

**Tools:**
- `POST /tools/:name/execute` — execute a tool directly
- `GET /tools` — list registered tools

**Conversations:**
- `GET /conversations` — list conversations
- `GET /conversations/:id` — get conversation history
- `DELETE /conversations/:id` — delete a conversation

**Memory:**
- `GET /memory` — list namespaces
- `GET /memory/:namespace` — list entries in a namespace
- `POST /memory/:namespace` — save a memory entry
- `DELETE /memory/:namespace/:key` — delete an entry

**Skills:**
- `GET /skills` — list skills
- `POST /skills` — create a skill
- `PATCH /skills/:name` — update a skill
- `DELETE /skills/:name` — delete a skill

**Commands:**
- `GET /commands` — list commands
- `POST /commands` — create/update a command
- `POST /commands/:name/run` — execute a command

**Tasks:**
- `GET /tasks` — list tasks
- `POST /tasks` — create a task
- `PATCH /tasks/:id` — update a task
- `DELETE /tasks/:id` — delete a task

**Crons** (when `cronScheduler` is configured):
- `GET /crons` — list cron jobs
- `POST /crons` — create a cron job
- `PATCH /crons/:id` — update a cron job
- `DELETE /crons/:id` — delete a cron job
- `GET /crons/:id/executions` — list past executions

**Jobs** (background):
- `GET /jobs` — list jobs
- `GET /jobs/:id` — get job status
- `GET /jobs/:id/stream` — reconnectable SSE stream
- `DELETE /jobs/:id` — cancel a job
