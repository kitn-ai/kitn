# kitn chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered scaffolding assistant — `kitn chat "I want X"` → LLM plans CLI actions → user confirms → CLI executes.

**Architecture:** Two sides. A service (`packages/chat-service/`) built with kitn's own framework (Hono + @kitnai/core) hosts an "assistant" agent with a guard and a `createPlan` tool. A CLI command (`kitn chat`) gathers context, calls the service, renders the plan, and executes confirmed steps via existing CLI functions.

**Tech Stack:** Hono, @kitnai/core, @kitnai/hono-adapter, Vercel AI SDK, @ai-sdk/openai, Zod, @clack/prompts, commander

---

### Task 1: Scaffold the chat-service package

**Files:**
- Create: `packages/chat-service/package.json`
- Create: `packages/chat-service/tsconfig.json`
- Create: `packages/chat-service/src/index.ts` (minimal placeholder)

**Step 1: Create package.json**

```json
{
  "name": "@kitnai/chat-service",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "description": "AI-powered scaffolding assistant service for kitn",
  "license": "MIT",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kitnai/core": "workspace:*",
    "@kitnai/hono-adapter": "workspace:*",
    "@ai-sdk/openai": "^1",
    "ai": "^4",
    "hono": "^4"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 3: Create minimal src/index.ts**

```ts
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT ?? 4002);

export default {
  port,
  fetch: app.fetch,
};

console.log(`kitn chat service running on http://localhost:${port}`);
```

**Step 4: Run `bun install` from repo root**

Run: `bun install`
Expected: installs workspace dependencies, links @kitnai/core and @kitnai/hono-adapter

**Step 5: Verify the server starts**

Run: `bun run --cwd packages/chat-service dev`
Expected: "kitn chat service running on http://localhost:4002"

**Step 6: Add dev:chat script to root package.json**

In the root `package.json`, add to `"scripts"`:
```json
"dev:chat": "bun run --cwd packages/chat-service dev"
```

**Step 7: Commit**

```bash
git add packages/chat-service/ package.json bun.lock
git commit -m "chore: scaffold chat-service package"
```

---

### Task 2: Create the createPlan tool

**Files:**
- Create: `packages/chat-service/src/tools/create-plan.ts`
- Test: `packages/chat-service/test/create-plan.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, test, expect } from "bun:test";
import { createPlanTool, type ChatPlan, type PlanStep } from "../src/tools/create-plan.js";

describe("createPlanTool", () => {
  test("tool has correct name and description", () => {
    expect(createPlanTool.description).toBeDefined();
  });

  test("accepts a valid add step", async () => {
    const input: ChatPlan = {
      summary: "I'll add the weather tool.",
      steps: [
        { action: "add", component: "weather-tool", reason: "Provides weather data" },
      ],
    };
    const result = await createPlanTool.execute!(input, { toolCallId: "test" } as any);
    expect(result).toEqual(input);
  });

  test("accepts a valid create step", async () => {
    const input: ChatPlan = {
      summary: "I'll create a Slack tool.",
      steps: [
        { action: "create", type: "tool", name: "slack-notify", description: "Sends Slack messages", reason: "Not in registry" },
      ],
    };
    const result = await createPlanTool.execute!(input, { toolCallId: "test" } as any);
    expect(result).toEqual(input);
  });

  test("accepts a valid link step", async () => {
    const input: ChatPlan = {
      summary: "I'll link the tool.",
      steps: [
        { action: "link", toolName: "weather-tool", agentName: "weather-agent", reason: "Agent needs weather" },
      ],
    };
    const result = await createPlanTool.execute!(input, { toolCallId: "test" } as any);
    expect(result).toEqual(input);
  });

  test("accepts multi-step plans", async () => {
    const input: ChatPlan = {
      summary: "Full setup.",
      steps: [
        { action: "add", component: "weather-tool", reason: "Exists in registry" },
        { action: "create", type: "tool", name: "slack-notify", description: "Slack messaging", reason: "Not in registry" },
        { action: "create", type: "agent", name: "weather-slack", description: "Weather + Slack agent", reason: "Custom agent" },
        { action: "link", toolName: "weather-tool", agentName: "weather-slack", reason: "Needs weather" },
        { action: "link", toolName: "slack-notify", agentName: "weather-slack", reason: "Needs Slack" },
      ],
    };
    const result = await createPlanTool.execute!(input, { toolCallId: "test" } as any);
    expect(result.steps).toHaveLength(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/chat-service/test/create-plan.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
import { tool } from "ai";
import { z } from "zod";

const planStepSchema = z.object({
  action: z.enum(["add", "create", "link", "remove", "unlink"]),
  component: z.string().optional().describe("Component name for add/remove (e.g. 'weather-tool')"),
  type: z.string().optional().describe("Component type for create: 'agent', 'tool', 'skill', 'storage'"),
  name: z.string().optional().describe("Component name for create (e.g. 'slack-notify')"),
  description: z.string().optional().describe("Description for create (what the component does)"),
  toolName: z.string().optional().describe("Tool name for link/unlink"),
  agentName: z.string().optional().describe("Agent name for link/unlink"),
  reason: z.string().describe("Why this step is needed"),
});

const chatPlanSchema = z.object({
  summary: z.string().describe("Brief summary of what the plan will accomplish"),
  steps: z.array(planStepSchema).describe("Ordered list of CLI actions to execute"),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type ChatPlan = z.infer<typeof chatPlanSchema>;

export const createPlanTool = tool({
  description:
    "Create an execution plan of kitn CLI actions. Call this once with the complete plan after analyzing the user's request against the available and installed components.",
  parameters: chatPlanSchema,
  execute: async (input) => input,
});
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/chat-service/test/create-plan.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/chat-service/src/tools/ packages/chat-service/test/
git commit -m "feat(chat-service): add createPlan tool with Zod schema"
```

---

### Task 3: Create the system prompt template

**Files:**
- Create: `packages/chat-service/src/prompts/system.ts`
- Test: `packages/chat-service/test/system-prompt.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../src/prompts/system.js";

describe("buildSystemPrompt", () => {
  test("includes registry components in prompt", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [
        { name: "weather-tool", type: "kitn:tool", description: "Weather data" },
        { name: "weather-agent", type: "kitn:agent", description: "Weather agent", registryDependencies: ["weather-tool"] },
      ],
      installed: ["core", "hono"],
    });
    expect(prompt).toContain("weather-tool");
    expect(prompt).toContain("weather-agent");
    expect(prompt).toContain("kitn:tool");
    expect(prompt).toContain("kitn:agent");
  });

  test("includes installed components", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: ["core", "hono", "general-agent"],
    });
    expect(prompt).toContain("core");
    expect(prompt).toContain("hono");
    expect(prompt).toContain("general-agent");
  });

  test("includes role and constraints", () => {
    const prompt = buildSystemPrompt({ registryIndex: [], installed: [] });
    expect(prompt).toContain("kitn assistant");
    expect(prompt).toContain("createPlan");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/chat-service/test/system-prompt.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
export interface RegistryItem {
  name: string;
  type: string;
  description: string;
  registryDependencies?: string[];
}

export interface PromptContext {
  registryIndex: RegistryItem[];
  installed: string[];
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const registrySection =
    ctx.registryIndex.length > 0
      ? ctx.registryIndex
          .map((item) => {
            const deps = item.registryDependencies?.length
              ? ` (depends on: ${item.registryDependencies.join(", ")})`
              : "";
            return `- ${item.name} [${item.type}]: ${item.description}${deps}`;
          })
          .join("\n")
      : "No components available in the registry.";

  const installedSection =
    ctx.installed.length > 0
      ? ctx.installed.join(", ")
      : "No components installed yet.";

  return `You are the kitn assistant. You help developers set up AI agents and tools using the kitn component registry.

## Available Components (from registry)

${registrySection}

## Currently Installed Components

${installedSection}

## Instructions

Analyze the developer's request. Follow these rules:

1. If a component exists in the registry that matches what they need, plan an "add" action.
2. If no matching component exists, plan a "create" action to scaffold a new one.
3. After adding/creating agents and tools, plan "link" actions to wire tools to agents.
4. If the request involves replacing or removing something, use "remove" and "unlink" actions.
5. Don't suggest adding components that are already installed unless the request is about replacing them.
6. Don't suggest creating components when a suitable one exists in the registry.

Call the createPlan tool exactly once with the complete plan.

## Constraints

- Only plan these actions: add, create, link, remove, unlink
- Don't suggest code changes or implementation details
- Don't explain how components work internally
- Keep the summary concise (one sentence)
- Order steps logically: removes/unlinks before adds, adds before creates, creates before links`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/chat-service/test/system-prompt.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add packages/chat-service/src/prompts/ packages/chat-service/test/system-prompt.test.ts
git commit -m "feat(chat-service): add system prompt template"
```

---

### Task 4: Create the assistant agent with guard

**Files:**
- Create: `packages/chat-service/src/agents/assistant.ts`
- Test: `packages/chat-service/test/guard.test.ts`

**Step 1: Write the failing test for the guard**

```ts
import { describe, test, expect } from "bun:test";
import { assistantGuard } from "../src/agents/assistant.js";

describe("assistantGuard", () => {
  test("allows requests about adding agents", async () => {
    const result = await assistantGuard("I want an agent that checks the weather");
    expect(result.allowed).toBe(true);
  });

  test("allows requests about adding tools", async () => {
    const result = await assistantGuard("Add a tool that sends Slack notifications");
    expect(result.allowed).toBe(true);
  });

  test("allows requests about removing components", async () => {
    const result = await assistantGuard("Remove the weather agent and its tools");
    expect(result.allowed).toBe(true);
  });

  test("allows requests about what's available", async () => {
    const result = await assistantGuard("What agents are available?");
    expect(result.allowed).toBe(true);
  });

  test("allows requests about linking tools", async () => {
    const result = await assistantGuard("Link the weather tool to my general agent");
    expect(result.allowed).toBe(true);
  });
});
```

Note: The guard function uses an LLM call for classification, so we test the keyword-based fast path here. The LLM-based classification is tested via integration tests.

**Step 2: Run test to verify it fails**

Run: `bun test packages/chat-service/test/guard.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { createPlanTool } from "../tools/create-plan.js";
import { buildSystemPrompt, type PromptContext } from "../prompts/system.js";

// Keywords that indicate a kitn-related request
const ALLOWED_KEYWORDS = [
  "agent", "tool", "skill", "storage", "component", "cron",
  "add", "create", "remove", "install", "uninstall", "link", "unlink",
  "scaffold", "setup", "set up", "build", "wire", "connect",
  "available", "registry", "what can", "what do you have",
];

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export async function assistantGuard(query: string): Promise<GuardResult> {
  const lower = query.toLowerCase();
  const hasKeyword = ALLOWED_KEYWORDS.some((kw) => lower.includes(kw));

  if (hasKeyword) {
    return { allowed: true };
  }

  // If no obvious keyword match, reject.
  // In the future, this could fall through to an LLM classifier for ambiguous cases.
  return {
    allowed: false,
    reason:
      "I can only help with setting up kitn components (agents, tools, skills, storage). Try something like 'I need an agent that summarizes articles' or 'What tools are available?'",
  };
}

export function registerAssistantAgent(plugin: AIPluginInstance, promptContext: PromptContext) {
  const tools = { createPlan: createPlanTool };
  const { jsonHandler } = plugin.createHandlers({ tools });

  const systemPrompt = buildSystemPrompt(promptContext);

  plugin.agents.register({
    name: "assistant",
    description: "AI-powered scaffolding assistant that plans kitn CLI actions",
    toolNames: ["createPlan"],
    defaultFormat: "json",
    defaultSystem: systemPrompt,
    tools,
    jsonHandler,
    guard: async (query) => assistantGuard(query),
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/chat-service/test/guard.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add packages/chat-service/src/agents/ packages/chat-service/test/guard.test.ts
git commit -m "feat(chat-service): add assistant agent with guard"
```

---

### Task 5: Wire up the service entry point

**Files:**
- Modify: `packages/chat-service/src/index.ts`

**Step 1: Update src/index.ts with full plugin wiring**

Replace the placeholder with the real implementation:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAIPlugin } from "@kitnai/hono-adapter";
import { createMemoryStorage } from "@kitnai/core";
import { createOpenAI } from "@ai-sdk/openai";
import { registerAssistantAgent } from "./agents/assistant.js";
import type { PromptContext } from "./prompts/system.js";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_API_KEY
    ? "https://openrouter.ai/api/v1"
    : undefined,
});

const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gpt-4o-mini";

const plugin = createAIPlugin({
  model: (id) => openai(id ?? DEFAULT_MODEL),
  storage: createMemoryStorage(),
});

// The prompt context is populated per-request from the CLI's metadata.
// For the agent registration, we use an empty default.
// The actual context is injected via the request body's system prompt override.
const defaultContext: PromptContext = { registryIndex: [], installed: [] };
registerAssistantAgent(plugin, defaultContext);

const app = new Hono();
app.use("/*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api", plugin.router);

const port = Number(process.env.PORT ?? 4002);

export default {
  port,
  fetch: app.fetch,
};

console.log(`kitn chat service running on http://localhost:${port}`);
```

**Step 2: Verify the server starts**

Run: `bun run --cwd packages/chat-service dev`
Expected: "kitn chat service running on http://localhost:4002"

**Step 3: Verify health endpoint**

Run: `curl -s http://localhost:4002/health`
Expected: `{"status":"ok"}`

**Step 4: Commit**

```bash
git add packages/chat-service/src/index.ts
git commit -m "feat(chat-service): wire up Hono server with assistant agent"
```

---

### Task 6: Handle per-request prompt context

The assistant agent's system prompt needs to be built dynamically from the request metadata (registry index + installed state sent by the CLI). The current kitn agent system uses `defaultSystem` as the base prompt, but we need to inject the per-request context.

**Files:**
- Modify: `packages/chat-service/src/agents/assistant.ts`
- Modify: `packages/chat-service/src/index.ts`

**Step 1: Update the agent to accept dynamic system prompt via request metadata**

The kitn agent route (`POST /api/agents/:agentName`) accepts a `systemPrompt` field in the request body that overrides the agent's `defaultSystem`. The CLI will build the system prompt client-side using the same `buildSystemPrompt` function (or we can expose the prompt builder as part of the service).

However, to keep the prompt logic server-side (a key design decision — so we can iterate without CLI releases), we need the service to build the prompt from the metadata.

**Approach:** Add a middleware or modify the agent route handling. The simplest approach for v1: the service has a dedicated endpoint (not the standard agent route) that accepts the metadata, builds the prompt, and calls the agent internally.

Create a custom route:

```ts
// In packages/chat-service/src/index.ts, add before app.route("/api", plugin.router):

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const { message, metadata } = body as {
    message: string;
    metadata?: { registryIndex?: RegistryItem[]; installed?: string[] };
  };

  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  // Build the system prompt from the metadata
  const promptContext: PromptContext = {
    registryIndex: metadata?.registryIndex ?? [],
    installed: metadata?.installed ?? [],
  };

  // Check the guard first
  const guardResult = await assistantGuard(message);
  if (!guardResult.allowed) {
    return c.json({ rejected: true, message: guardResult.reason }, 200);
  }

  // Build dynamic system prompt
  const systemPrompt = buildSystemPrompt(promptContext);

  // Call the agent's JSON handler directly
  const agent = plugin.agents.get("assistant");
  if (!agent) {
    return c.json({ error: "assistant agent not registered" }, 500);
  }

  // Use the generate endpoint pattern — call the model directly
  const { generateText } = await import("ai");
  const result = await generateText({
    model: openai(DEFAULT_MODEL),
    system: systemPrompt,
    prompt: message,
    tools: { createPlan: createPlanTool },
    maxSteps: 1,
  });

  // Extract the plan from tool calls
  const planCall = result.steps
    .flatMap((s) => s.toolCalls)
    .find((tc) => tc.toolName === "createPlan");

  if (planCall) {
    return c.json({ plan: planCall.args });
  }

  // Fallback — model responded with text instead of calling the tool
  return c.json({ text: result.text });
});
```

**Step 2: Add the necessary imports to index.ts**

Add to the import block:
```ts
import { assistantGuard } from "./agents/assistant.js";
import { buildSystemPrompt, type PromptContext, type RegistryItem } from "./prompts/system.js";
import { createPlanTool } from "./tools/create-plan.js";
```

**Step 3: Verify with a curl test**

Run (with OPENAI_API_KEY set):
```bash
curl -s http://localhost:4002/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I want a weather agent",
    "metadata": {
      "registryIndex": [
        {"name": "weather-tool", "type": "kitn:tool", "description": "Weather data from Open-Meteo"},
        {"name": "weather-agent", "type": "kitn:agent", "description": "Weather specialist", "registryDependencies": ["weather-tool"]}
      ],
      "installed": ["core", "hono"]
    }
  }'
```

Expected: JSON response with a `plan` containing steps to add weather-agent (which depends on weather-tool).

**Step 4: Verify guard rejection**

Run:
```bash
curl -s http://localhost:4002/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Write me a poem about cats"}'
```

Expected: `{"rejected":true,"message":"I can only help with..."}`

**Step 5: Commit**

```bash
git add packages/chat-service/src/
git commit -m "feat(chat-service): add /api/chat endpoint with per-request prompt context"
```

---

### Task 7: Add config schema for chatService

**Files:**
- Modify: `packages/cli/src/utils/config.ts`
- Test: verify typecheck passes

**Step 1: Read the current config schema**

Read `packages/cli/src/utils/config.ts` and locate the `configSchema` Zod definition.

**Step 2: Add chatService field**

Add to the `configSchema` z.object:

```ts
chatService: z.object({
  url: z.string().url().optional(),
}).optional(),
```

**Step 3: Run typecheck**

Run: `bun run --cwd packages/cli typecheck`
Expected: PASS

**Step 4: Run existing tests**

Run: `bun run --cwd packages/cli test`
Expected: PASS (no regressions)

**Step 5: Commit**

```bash
git add packages/cli/src/utils/config.ts
git commit -m "feat(cli): add chatService config field for kitn chat"
```

---

### Task 8: Build the CLI chat command

**Files:**
- Create: `packages/cli/src/commands/chat.ts`
- Test: `packages/cli/test/chat.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveServiceUrl,
  buildRequestPayload,
  formatPlan,
} from "../src/commands/chat.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kitn-chat-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("resolveServiceUrl", () => {
  test("returns default URL when no config", () => {
    expect(resolveServiceUrl(undefined)).toBe("https://chat.kitn.dev");
  });

  test("returns config URL when set", () => {
    expect(resolveServiceUrl({ url: "http://localhost:4002" })).toBe("http://localhost:4002");
  });

  test("prefers KITN_CHAT_URL env var", () => {
    const original = process.env.KITN_CHAT_URL;
    process.env.KITN_CHAT_URL = "http://custom:9000";
    expect(resolveServiceUrl({ url: "http://localhost:4002" })).toBe("http://custom:9000");
    if (original) process.env.KITN_CHAT_URL = original;
    else delete process.env.KITN_CHAT_URL;
  });
});

describe("buildRequestPayload", () => {
  test("builds payload with message and metadata", () => {
    const payload = buildRequestPayload("I want a weather agent", {
      registryIndex: [{ name: "weather-tool", type: "kitn:tool", description: "Weather" }],
      installed: ["core"],
    });
    expect(payload.message).toBe("I want a weather agent");
    expect(payload.metadata.registryIndex).toHaveLength(1);
    expect(payload.metadata.installed).toEqual(["core"]);
  });
});

describe("formatPlan", () => {
  test("formats add steps", () => {
    const output = formatPlan({
      summary: "Adding weather.",
      steps: [{ action: "add", component: "weather-tool", reason: "Provides weather data" }],
    });
    expect(output).toContain("Add weather-tool");
    expect(output).toContain("Provides weather data");
  });

  test("formats create steps", () => {
    const output = formatPlan({
      summary: "Creating slack tool.",
      steps: [{ action: "create", type: "tool", name: "slack-notify", reason: "Not in registry" }],
    });
    expect(output).toContain("Create tool slack-notify");
  });

  test("formats link steps", () => {
    const output = formatPlan({
      summary: "Linking.",
      steps: [{ action: "link", toolName: "weather-tool", agentName: "my-agent", reason: "Needs weather" }],
    });
    expect(output).toContain("weather-tool");
    expect(output).toContain("my-agent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/chat.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { ChatPlan, PlanStep } from "./chat-types.js";

const DEFAULT_SERVICE_URL = "https://chat.kitn.dev";

export function resolveServiceUrl(chatServiceConfig?: { url?: string }): string {
  if (process.env.KITN_CHAT_URL) return process.env.KITN_CHAT_URL;
  if (chatServiceConfig?.url) return chatServiceConfig.url;
  return DEFAULT_SERVICE_URL;
}

export function buildRequestPayload(
  message: string,
  metadata: { registryIndex: { name: string; type: string; description: string; registryDependencies?: string[] }[]; installed: string[] },
) {
  return { message, metadata };
}

function formatStep(step: PlanStep, index: number): string {
  const num = `${index + 1}.`;
  switch (step.action) {
    case "add":
      return `${num} Add ${pc.cyan(step.component ?? "?")} — ${step.reason}`;
    case "remove":
      return `${num} Remove ${pc.red(step.component ?? "?")} — ${step.reason}`;
    case "create":
      return `${num} Create ${step.type} ${pc.green(step.name ?? "?")} — ${step.reason}`;
    case "link":
      return `${num} Link ${pc.cyan(step.toolName ?? "?")} → ${pc.cyan(step.agentName ?? "?")} — ${step.reason}`;
    case "unlink":
      return `${num} Unlink ${pc.red(step.toolName ?? "?")} from ${pc.cyan(step.agentName ?? "?")} — ${step.reason}`;
    default:
      return `${num} ${step.action} — ${step.reason}`;
  }
}

export function formatPlan(plan: ChatPlan): string {
  const lines = plan.steps.map((step, i) => formatStep(step, i));
  return `${plan.summary}\n\n${lines.join("\n")}`;
}

async function callService(
  serviceUrl: string,
  payload: ReturnType<typeof buildRequestPayload>,
): Promise<{ plan?: ChatPlan; rejected?: boolean; message?: string; text?: string; error?: string }> {
  const url = `${serviceUrl.replace(/\/$/, "")}/api/chat`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const apiKey = process.env.KITN_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Service returned ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function executePlan(steps: PlanStep[], cwd: string): Promise<void> {
  for (const step of steps) {
    const spinner = p.spinner();

    switch (step.action) {
      case "add": {
        spinner.start(`Adding ${step.component}`);
        const { addCommand } = await import("./add.js");
        await addCommand([step.component!], { yes: true });
        spinner.stop(`Added ${step.component}`);
        break;
      }
      case "create": {
        spinner.start(`Creating ${step.type} ${step.name}`);
        const { createCommand } = await import("./create.js");
        await createCommand(step.type!, step.name!);
        spinner.stop(`Created ${step.type} ${step.name}`);
        break;
      }
      case "link": {
        spinner.start(`Linking ${step.toolName} → ${step.agentName}`);
        const { linkCommand } = await import("./link.js");
        await linkCommand("tool", step.toolName, { to: step.agentName });
        spinner.stop(`Linked ${step.toolName} → ${step.agentName}`);
        break;
      }
      case "remove": {
        spinner.start(`Removing ${step.component}`);
        const { removeCommand } = await import("./remove.js");
        await removeCommand(step.component);
        spinner.stop(`Removed ${step.component}`);
        break;
      }
      case "unlink": {
        spinner.start(`Unlinking ${step.toolName} from ${step.agentName}`);
        const { unlinkCommand } = await import("./unlink.js");
        await unlinkCommand("tool", step.toolName, { from: step.agentName });
        spinner.stop(`Unlinked ${step.toolName} from ${step.agentName}`);
        break;
      }
    }
  }
}

export async function chatCommand(message: string | undefined): Promise<void> {
  const cwd = process.cwd();
  const config = await readConfig(cwd);

  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  if (!message) {
    p.log.error("Please provide a message. Example: kitn chat \"I want a weather agent\"");
    process.exit(1);
  }

  p.intro(pc.bold("kitn assistant"));

  // 1. Gather context
  const spinner = p.spinner();
  spinner.start("Gathering project context...");

  const fetcher = new RegistryFetcher(config.registries);
  let registryIndex: { name: string; type: string; description: string; registryDependencies?: string[] }[] = [];
  try {
    const index = await fetcher.fetchIndex();
    registryIndex = index.items.map((item) => ({
      name: item.name,
      type: item.type,
      description: item.description,
      registryDependencies: item.registryDependencies,
    }));
  } catch {
    // Registry unavailable — proceed with empty index
  }

  const lock = await (await import("../utils/config.js")).readLock(cwd);
  const installed = Object.keys(lock);

  spinner.stop("Context gathered.");

  // 2. Call the service
  spinner.start("Thinking...");

  const serviceUrl = resolveServiceUrl(config.chatService);
  const payload = buildRequestPayload(message, { registryIndex, installed });

  let response: Awaited<ReturnType<typeof callService>>;
  try {
    response = await callService(serviceUrl, payload);
  } catch (error) {
    spinner.stop("Failed.");
    p.log.error(
      `Could not reach the kitn chat service at ${serviceUrl}.\n` +
        "Check your connection or set KITN_CHAT_URL to point to your own instance.",
    );
    process.exit(1);
  }

  spinner.stop("Done.");

  // 3. Handle rejection
  if (response.rejected) {
    p.log.warn(response.message ?? "Request was rejected by the assistant.");
    p.outro("Try a different request.");
    return;
  }

  // 4. Handle text response (model didn't call createPlan)
  if (response.text && !response.plan) {
    p.log.info(response.text);
    p.outro("");
    return;
  }

  // 5. Render the plan
  if (!response.plan) {
    p.log.error("The assistant returned an unexpected response.");
    process.exit(1);
  }

  const plan = response.plan;
  p.log.message(formatPlan(plan));

  // 6. Confirm
  const action = await p.select({
    message: "Execute this plan?",
    options: [
      { value: "all", label: "Yes, run all steps" },
      { value: "select", label: "Select which steps to run" },
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    p.outro("Cancelled.");
    return;
  }

  let stepsToRun = plan.steps;

  if (action === "select") {
    const selected = await p.multiselect({
      message: "Select steps to run:",
      options: plan.steps.map((step, i) => ({
        value: i,
        label: formatStep(step, i),
      })),
    });

    if (p.isCancel(selected)) {
      p.outro("Cancelled.");
      return;
    }

    stepsToRun = (selected as number[]).map((i) => plan.steps[i]);
  }

  // 7. Execute
  try {
    await executePlan(stepsToRun, cwd);
  } catch (error) {
    p.log.error(`Execution error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  p.outro(pc.green("All done! Run your dev server to test the new components."));
}
```

**Step 4: Create the shared types file**

Create `packages/cli/src/commands/chat-types.ts`:

```ts
export interface PlanStep {
  action: "add" | "create" | "link" | "remove" | "unlink";
  component?: string;
  type?: string;
  name?: string;
  description?: string;
  toolName?: string;
  agentName?: string;
  reason: string;
}

export interface ChatPlan {
  summary: string;
  steps: PlanStep[];
}
```

**Step 5: Run test to verify it passes**

Run: `bun test packages/cli/test/chat.test.ts`
Expected: PASS (all tests)

**Step 6: Commit**

```bash
git add packages/cli/src/commands/chat.ts packages/cli/src/commands/chat-types.ts packages/cli/test/chat.test.ts
git commit -m "feat(cli): add kitn chat command"
```

---

### Task 9: Register the CLI command

**Files:**
- Modify: `packages/cli/src/index.ts`

**Step 1: Add the chat command registration**

Add after the existing command registrations (before `program.parseAsync()`):

```ts
program
  .command("chat")
  .description("AI-powered scaffolding assistant — describe what you need in plain English")
  .argument("<message>", "what you want to build (e.g. \"I want a weather agent\")")
  .action(async (message: string) => {
    const { chatCommand } = await import("./commands/chat.js");
    await chatCommand(message);
  });
```

**Step 2: Build the CLI**

Run: `bun run --cwd packages/cli build`
Expected: PASS

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): register kitn chat command"
```

---

### Task 10: Add Dockerfile

**Files:**
- Create: `packages/chat-service/Dockerfile`
- Create: `packages/chat-service/.dockerignore`

**Step 1: Create Dockerfile**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Run
EXPOSE 4002
ENV PORT=4002

CMD ["bun", "run", "src/index.ts"]
```

Note: This Dockerfile is for standalone deployment of the chat-service. It assumes the workspace dependencies (@kitnai/core, @kitnai/hono-adapter) are published to npm. For local development, use `bun run dev` directly.

**Step 2: Create .dockerignore**

```
node_modules
dist
test
*.test.ts
.git
```

**Step 3: Commit**

```bash
git add packages/chat-service/Dockerfile packages/chat-service/.dockerignore
git commit -m "feat(chat-service): add Dockerfile for deployment"
```

---

### Task 11: Integration test — end-to-end flow

**Files:**
- Create: `packages/chat-service/test/integration.test.ts`

This test starts the service, sends a request, and validates the response shape. It requires an `OPENAI_API_KEY` to run, so it's skipped in CI unless the key is available.

**Step 1: Write the integration test**

```ts
import { describe, test, expect } from "bun:test";

const SERVICE_URL = process.env.KITN_CHAT_URL ?? "http://localhost:4002";
const HAS_API_KEY = !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);

describe.skipIf(!HAS_API_KEY)("chat service integration", () => {
  test("returns a plan for a valid request", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I want a weather agent",
        metadata: {
          registryIndex: [
            { name: "weather-tool", type: "kitn:tool", description: "Weather data from Open-Meteo" },
            { name: "weather-agent", type: "kitn:agent", description: "Weather specialist agent", registryDependencies: ["weather-tool"] },
          ],
          installed: ["core", "hono"],
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.plan).toBeDefined();
    expect(data.plan.summary).toBeDefined();
    expect(data.plan.steps).toBeInstanceOf(Array);
    expect(data.plan.steps.length).toBeGreaterThan(0);

    // Should suggest adding weather-agent (and its dep weather-tool)
    const actions = data.plan.steps.map((s: any) => s.action);
    expect(actions).toContain("add");
  });

  test("rejects off-topic requests", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Write me a poem about cats",
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.rejected).toBe(true);
    expect(data.message).toBeDefined();
  });

  test("handles missing message gracefully", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("health check works", async () => {
    const res = await fetch(`${SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
```

**Step 2: Start the service (in a separate terminal)**

Run: `OPENAI_API_KEY=<key> bun run --cwd packages/chat-service dev`

**Step 3: Run the integration test**

Run: `OPENAI_API_KEY=<key> bun test packages/chat-service/test/integration.test.ts`
Expected: PASS (all 4 tests)

**Step 4: Commit**

```bash
git add packages/chat-service/test/integration.test.ts
git commit -m "test(chat-service): add integration tests"
```

---

### Task 12: Final verification and cleanup

**Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 2: Run all CLI tests**

Run: `bun run --cwd packages/cli test`
Expected: PASS

**Step 3: Run chat-service unit tests**

Run: `bun test packages/chat-service/test/create-plan.test.ts packages/chat-service/test/system-prompt.test.ts packages/chat-service/test/guard.test.ts`
Expected: PASS

**Step 4: Verify CLI builds**

Run: `bun run --cwd packages/cli build`
Expected: PASS

**Step 5: Manual smoke test**

Start the service locally:
```bash
OPENAI_API_KEY=<key> bun run dev:chat
```

In another terminal, run the CLI:
```bash
KITN_CHAT_URL=http://localhost:4002 kitn chat "I want a weather agent"
```

Expected: Shows a plan, prompts for confirmation.

**Step 6: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: kitn chat cleanup and verification"
```
