# API Example Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update `examples/api/` to showcase every kitn feature — crons, commands, additional registry-style tools — with a rewritten developer-friendly README.

**Architecture:** Extend the existing manual-wiring pattern. Add hackernews and web-search tools as new files (adapted from registry source, no self-registration). Wire `createInternalScheduler` into plugin config. Add a sample command via the storage API. Rewrite README for getting-started audience.

**Tech Stack:** TypeScript, Bun, Hono, @kitnai/hono-adapter (re-exports @kitnai/core)

---

### Task 1: Add hackernews tool

**Files:**
- Create: `examples/api/src/tools/hackernews.ts`
- Modify: `examples/api/src/index.ts`

**Step 1: Create the hackernews tool file**

Create `examples/api/src/tools/hackernews.ts`. Adapt from `registry/components/tools/hackernews-tool/hackernews.ts` — remove `registerTool()` self-registration calls, use the same pattern as the existing tools (export the AI SDK tool + a `registerXxxTool(plugin)` function):

```ts
import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono-adapter";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

export const hackernewsTopStoriesTool = tool({
  description:
    "Get the current top stories from Hacker News. Returns a list of stories with titles, scores, and URLs.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(30)
      .default(10)
      .describe("Number of top stories to return (max 30)"),
  }),
  execute: async ({ limit }) => {
    const response = await fetch(`${HN_BASE}/topstories.json`);
    if (!response.ok) throw new Error("Failed to fetch top stories");

    const ids: number[] = await response.json();
    const topIds = ids.slice(0, limit);

    const stories = await Promise.all(
      topIds.map(async (id) => {
        const res = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!res.ok) return null;
        const item = await res.json();
        return {
          id: item.id,
          title: item.title,
          url: item.url ?? null,
          score: item.score,
          by: item.by,
          time: new Date(item.time * 1000).toISOString(),
          descendants: item.descendants ?? 0,
        };
      })
    );

    const validStories = stories.filter(Boolean);
    return { stories: validStories, count: validStories.length };
  },
});

export const hackernewsStoryDetailTool = tool({
  description:
    "Get detailed information about a specific Hacker News story by its ID, including top comments.",
  inputSchema: z.object({
    storyId: z.number().describe("The Hacker News story ID"),
  }),
  execute: async ({ storyId }) => {
    const response = await fetch(`${HN_BASE}/item/${storyId}.json`);
    if (!response.ok) throw new Error(`Failed to fetch story ${storyId}`);

    const story = await response.json();
    if (!story) throw new Error(`Story ${storyId} not found`);

    const commentIds = (story.kids ?? []).slice(0, 5);
    const comments = await Promise.all(
      commentIds.map(async (id: number) => {
        const res = await fetch(`${HN_BASE}/item/${id}.json`);
        if (!res.ok) return null;
        const item = await res.json();
        return {
          id: item.id,
          by: item.by,
          text: item.text?.slice(0, 500) ?? "",
          time: new Date(item.time * 1000).toISOString(),
        };
      })
    );

    return {
      id: story.id,
      title: story.title,
      url: story.url ?? null,
      score: story.score,
      by: story.by,
      time: new Date(story.time * 1000).toISOString(),
      descendants: story.descendants ?? 0,
      text: story.text ?? null,
      topComments: comments.filter(Boolean),
    };
  },
});

export function registerHackernewsTools(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "hackernewsTopStories",
    description: "Get the current top stories from Hacker News",
    inputSchema: z.object({
      limit: z.number().min(1).max(30).default(10),
    }),
    tool: hackernewsTopStoriesTool,
    directExecute: async (input) =>
      hackernewsTopStoriesTool.execute!(input, { toolCallId: "direct" } as any),
    category: "news",
  });

  plugin.tools.register({
    name: "hackernewsStoryDetail",
    description: "Get detailed information about a specific Hacker News story",
    inputSchema: z.object({
      storyId: z.number(),
    }),
    tool: hackernewsStoryDetailTool,
    directExecute: async (input) =>
      hackernewsStoryDetailTool.execute!(input, { toolCallId: "direct" } as any),
    category: "news",
  });
}
```

**Step 2: Register in index.ts**

Add import and call in `examples/api/src/index.ts`:

```ts
import { registerHackernewsTools } from "./tools/hackernews.js";
```

And in the "Register tools" section:

```ts
registerHackernewsTools(plugin);
```

**Step 3: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add examples/api/src/tools/hackernews.ts examples/api/src/index.ts
git commit -m "feat(example-api): add hackernews tools"
```

---

### Task 2: Add web-search tool

**Files:**
- Create: `examples/api/src/tools/web-search.ts`
- Modify: `examples/api/src/index.ts`

**Step 1: Create the web-search tool file**

Create `examples/api/src/tools/web-search.ts`. Adapt from `registry/components/tools/web-search-tool/web-search.ts` — same pattern as Task 1. Uses `env.BRAVE_API_KEY` (already validated in env.ts):

```ts
import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { env } from "../env.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export const searchWebTool = tool({
  description:
    "Search the web using Brave Search. Returns a list of results with titles, URLs, and descriptions. Requires BRAVE_API_KEY.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of results to return (1-10, default 5)"),
  }),
  execute: async ({ query, count }) => {
    if (!env.BRAVE_API_KEY) {
      throw new Error("BRAVE_API_KEY environment variable is required for web search");
    }

    const params = new URLSearchParams({
      q: query,
      count: String(count ?? 5),
    });

    const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.BRAVE_API_KEY,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const webResults = data.web?.results ?? [];

    return {
      query,
      resultCount: webResults.length,
      results: webResults.map(
        (r: { title: string; url: string; description: string; thumbnail?: { src: string } }) => ({
          title: stripHtml(r.title),
          url: r.url,
          description: stripHtml(r.description),
          ...(r.thumbnail?.src && { thumbnail: r.thumbnail.src }),
        })
      ),
    };
  },
});

export function registerWebSearchTool(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "searchWeb",
    description: "Search the web using Brave Search",
    inputSchema: z.object({
      query: z.string(),
      count: z.number().min(1).max(10).default(5),
    }),
    tool: searchWebTool,
    directExecute: async (input) =>
      searchWebTool.execute!(input, { toolCallId: "direct" } as any),
    category: "search",
  });
}
```

**Step 2: Register in index.ts**

Add import:

```ts
import { registerWebSearchTool } from "./tools/web-search.js";
```

And in the "Register tools" section:

```ts
registerWebSearchTool(plugin);
```

**Step 3: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add examples/api/src/tools/web-search.ts examples/api/src/index.ts
git commit -m "feat(example-api): add web search tool (Brave Search)"
```

---

### Task 3: Update general agent with new tools

**Files:**
- Modify: `examples/api/src/agents/general.ts`

**Step 1: Add new tools to the general agent**

Update `examples/api/src/agents/general.ts` to include hackernews and web-search tools:

```ts
import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { echoTool } from "../tools/echo.js";
import { weatherTool } from "../tools/weather.js";
import { calculatorTool } from "../tools/calculator.js";
import { hackernewsTopStoriesTool, hackernewsStoryDetailTool } from "../tools/hackernews.js";
import { searchWebTool } from "../tools/web-search.js";

export function registerGeneralAgent(plugin: AIPluginInstance) {
  const tools = {
    echo: echoTool,
    getWeather: weatherTool,
    calculate: calculatorTool,
    hackernewsTopStories: hackernewsTopStoriesTool,
    hackernewsStoryDetail: hackernewsStoryDetailTool,
    searchWeb: searchWebTool,
  };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

  plugin.agents.register({
    name: "general",
    description:
      "General-purpose agent with weather, calculator, web search, and Hacker News tools",
    toolNames: [
      "echo",
      "getWeather",
      "calculate",
      "hackernewsTopStories",
      "hackernewsStoryDetail",
      "searchWeb",
    ],
    defaultFormat: "sse",
    defaultSystem:
      "You are a helpful assistant. Use your tools to help the user. You can echo messages, check weather, do math calculations, search the web, and browse Hacker News.",
    tools,
    sseHandler,
    jsonHandler,
  });
}
```

**Step 2: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add examples/api/src/agents/general.ts
git commit -m "feat(example-api): add hackernews and web search to general agent"
```

---

### Task 4: Add sample command

**Files:**
- Modify: `examples/api/src/index.ts`

**Step 1: Add a status command**

Commands are stored via `plugin.storage.commands.save()`. Add after the "Register agents" section in `index.ts`:

```ts
// Register commands
await plugin.storage.commands.save({
  name: "status",
  description: "Show server status including registered agents, tools, and uptime",
  system: "Report the current server status. Include the list of registered agents and tools, and the server uptime. Be concise.",
  tools: ["echo"],
});
```

Note: Since this uses `await`, you'll need to wrap the top-level registration code or use top-level await (Bun supports it). The existing `index.ts` is already top-level module code, so `await` works directly at the module level in Bun.

**Step 2: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add examples/api/src/index.ts
git commit -m "feat(example-api): add sample status command"
```

---

### Task 5: Wire up cron scheduling

**Files:**
- Modify: `examples/api/src/index.ts`

**Step 1: Add InternalScheduler to plugin config and start it**

In `examples/api/src/index.ts`, the change has two parts:

1. Create the plugin with `cronScheduler` — but `createInternalScheduler` needs `ctx` (the PluginContext) which is returned by `createAIPlugin`. The solution: create the plugin first, then create the scheduler from the plugin context, and assign it. However, `cronScheduler` is set at creation time in the adapter config.

Looking at the adapter code, the simplest approach: create the internal scheduler after plugin creation and start it. The cron routes are gated on `cronScheduler` being present in the config, so we need to pass it at creation time.

The correct approach: since `createInternalScheduler` needs `ctx` and `createAIPlugin` returns `ctx`, we have a chicken-and-egg. The pattern is:

```ts
import { createAIPlugin, createFileStorage, createInternalScheduler, OpenAIVoiceProvider } from "@kitnai/hono-adapter";

// Create a placeholder scheduler reference
let scheduler: ReturnType<typeof createInternalScheduler>;

const storage = createFileStorage({ dataDir: "./data" });

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? env.DEFAULT_MODEL),
  storage,
  resilience: { maxRetries: 2, baseDelayMs: 500 },
  compaction: { threshold: 20, preserveRecent: 4 },
  cronScheduler: {
    async schedule() {},
    async unschedule() {},
  },
  ...(voiceEnabled && {
    voice: { retainAudio: env.VOICE_RETAIN_AUDIO },
  }),
});

// Create and start the internal scheduler (uses plugin as PluginContext)
scheduler = createInternalScheduler(plugin, {
  onComplete: (job, exec) => console.log(`[cron] Completed: ${job.name} (${exec.id})`),
  onError: (job, err) => console.error(`[cron] Failed: ${job.name}:`, err.message),
});
scheduler.start();
console.log("[cron] Internal scheduler started");
```

The no-op `cronScheduler` in the config enables the `/crons` API routes. The actual `createInternalScheduler` handles the tick loop using the PluginContext (which the plugin instance satisfies since `AIPluginInstance extends PluginContext`).

2. Seed a sample cron job to demonstrate the feature:

```ts
// Seed a sample cron job (if not already created)
const existingJobs = await plugin.storage.crons.listJobs();
if (!existingJobs.some((j) => j.name === "hourly-news-digest")) {
  await plugin.storage.crons.createJob({
    name: "hourly-news-digest",
    schedule: "0 * * * *",
    agentName: "general",
    input: "Give me a brief summary of the top 5 Hacker News stories right now.",
    enabled: true,
  });
  console.log("[cron] Seeded sample job: hourly-news-digest (runs every hour)");
}
```

**Step 2: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add examples/api/src/index.ts
git commit -m "feat(example-api): wire up cron scheduling with internal scheduler"
```

---

### Task 6: Update .env.example

**Files:**
- Modify: `examples/api/.env.example`

**Step 1: Update .env.example**

The current file has `API_KEY=demo` but the README says `test`. Fix the inconsistency and organize sections:

```env
# Required
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Server
DEFAULT_MODEL=openai/gpt-4o-mini
API_KEY=demo
PORT=4000

# Web Search (optional — enables searchWeb tool)
BRAVE_API_KEY=your-key-here

# Voice (optional — enables /api/voice endpoints)
OPENAI_API_KEY=sk-your-key-here
GROQ_API_KEY=gsk_your-key-here
VOICE_PROVIDER=openai
VOICE_TTS_MODEL=tts-1
VOICE_STT_MODEL=gpt-4o-mini-transcribe
VOICE_DEFAULT_SPEAKER=alloy
VOICE_RETAIN_AUDIO=false
```

Remove the unused `TMDB_API_KEY` line (no tool uses it).

**Step 2: Commit**

```bash
git add examples/api/.env.example
git commit -m "chore(example-api): organize .env.example, remove unused TMDB key"
```

---

### Task 7: Rewrite README

**Files:**
- Modify: `examples/api/README.md`

**Step 1: Rewrite the README**

Replace the entire README with a developer-friendly version. Key changes:
- Mentions this is the "comprehensive" example, points to `getting-started/` for the simple path
- Mentions installing the kitn CLI
- Updated agents/tools tables to include new additions
- Adds cron and commands sections
- Fixes the API_KEY discrepancy (default is `demo`, not `test`)
- Organized into clear sections
- Updated project structure tree
- Adds curl examples for new features (crons, commands, web search, hackernews)

Full README content:

```markdown
# kitn API Example

The comprehensive example — every kitn feature wired up manually in one Hono server. If you want the quick CLI-based path instead, see [`getting-started/`](../getting-started/).

## What's Inside

- **6 tools** — echo, weather, calculator, web search, Hacker News (top stories + detail)
- **2 agents** — general (multi-tool) and guarded (input filtering)
- **Orchestrator** — autonomous agent routing
- **Cron scheduling** — InternalScheduler with sample hourly job
- **Commands** — stored command definitions via the commands API
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

## Further Reading

- [`getting-started/`](../getting-started/) — minimal example using the kitn CLI
- [kitn CLI on npm](https://www.npmjs.com/package/@kitnai/cli) — `kitn init`, `kitn add`, `kitn list`
- [Main README](../../README.md) — full architecture overview
```

**Step 2: Commit**

```bash
git add examples/api/README.md
git commit -m "docs(example-api): rewrite README for developer getting-started audience"
```

---

### Task 8: Clean up env.ts

**Files:**
- Modify: `examples/api/src/env.ts`

**Step 1: Remove TMDB_API_KEY from env validation**

Since no tool uses TMDB, remove it from the env schema in `examples/api/src/env.ts`. Delete the line:

```ts
TMDB_API_KEY: z.string().default(""),
```

And remove the TMDB line from `printConfig()`:

```ts
console.log(`    TMDB               : ${status(env.TMDB_API_KEY)}`);
```

Add a Cron line to printConfig() services section:

```ts
console.log(`    Cron Scheduler     : active (internal)`);
```

**Step 2: Verify it compiles**

Run: `bun run --cwd examples/api typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add examples/api/src/env.ts
git commit -m "chore(example-api): remove unused TMDB env var, add cron to status output"
```

---

### Task 9: Final verification

**Step 1: Typecheck the full monorepo**

Run: `bun run typecheck`
Expected: All packages pass

**Step 2: Run all tests**

Run: `bun run test`
Expected: All tests pass (example-api has no tests, but other packages should be unaffected)

**Step 3: Build**

Run: `bun run build`
Expected: All packages build

**Step 4: Commit any remaining changes**

If there are any tweaks needed from verification, fix and commit.
