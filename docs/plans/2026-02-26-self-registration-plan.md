# Self-Registration, Commands & Scoped Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add self-registration API to core, commands as a new component type, optional scopeId on storage, and CLI auto-wiring of barrel files.

**Architecture:** Per-type registration functions (`registerAgent`, `registerTool`, `registerCommand`, `registerSkill`) collect configs into module-level Maps. A single `registerWithPlugin(ctx)` call flushes everything into the plugin. The CLI manages a barrel file (`src/ai/index.ts`) that auto-imports kitn-installed components. Commands are a lightweight agent config (prompt + tools). scopeId is an optional last parameter on storage methods.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK, Hono, Zod, @clack/prompts

**Design doc:** `docs/plans/2026-02-26-self-registration-design.md`

---

## Phase 1: Self-Registration API + Body Fix + Model Rename

### Task 1: Rename `getModel` to `model` across codebase

**Files:**
- Modify: `packages/core/src/types.ts:56-83`
- Modify: `packages/hono/src/types.ts:15-19`
- Modify: `packages/hono/src/plugin.ts:47`
- Modify: `packages/core/src/agents/orchestrator.ts` (lines 138, 155, 335, 470)
- Modify: `packages/core/src/agents/run-agent.ts:30`
- Modify: `packages/core/src/streaming/stream-helpers.ts:35`
- Modify: `packages/core/src/utils/compaction.ts:76`
- Modify: `packages/hono/src/routes/generate/generate.handlers.ts` (lines 39, 76)
- Modify: `examples/api/src/index.ts` (if it references getModel)
- Test: `bun run test` (all existing tests)

**Step 1: Update CoreConfig and PluginContext types**

In `packages/core/src/types.ts`:
- Rename `CoreConfig.getModel` to `CoreConfig.model` (line ~58)
- Rename `PluginContext.getModel` to `PluginContext.model` (line ~77)
- Update JSDoc to say "Resolves a LanguageModel for the given model name (or default)"
- Change parameter name from `id` to `model` in both

**Step 2: Update AIPluginConfig**

In `packages/hono/src/types.ts`: `AIPluginConfig extends CoreConfig`, so it inherits the rename automatically. No change needed unless there's an override.

**Step 3: Update plugin.ts context creation**

In `packages/hono/src/plugin.ts:47`: change `getModel: config.getModel` to `model: config.model`

**Step 4: Update all call sites in core**

Find-and-replace `ctx.getModel` with `ctx.model` in:
- `packages/core/src/agents/orchestrator.ts` (4 occurrences: lines 138, 155, 335, 470)
- `packages/core/src/agents/run-agent.ts` (1 occurrence: line 30)
- `packages/core/src/streaming/stream-helpers.ts` (1 occurrence: line 35)
- `packages/core/src/utils/compaction.ts` (1 occurrence: line 76)

**Step 5: Update call sites in hono**

Find-and-replace `ctx.getModel` with `ctx.model` in:
- `packages/hono/src/routes/generate/generate.handlers.ts` (2 occurrences: lines 39, 76)

**Step 6: Update examples**

Update any `getModel:` references in `examples/` to `model:`.

**Step 7: Run tests and build**

```bash
bun run build
bun run --cwd packages/core test
bun run --cwd packages/hono test
```

Expected: all tests pass, build succeeds.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename getModel to model across codebase"
```

---

### Task 2: Create self-registration module in core

**Files:**
- Create: `packages/core/src/registry/self-register.ts`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/self-register.test.ts`

**Step 1: Write the failing test**

Create `packages/core/test/self-register.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import {
  registerAgent,
  registerTool,
  registerCommand,
  registerSkill,
  registerWithPlugin,
  _resetForTesting,
} from "../src/registry/self-register.js";

// Minimal mock PluginContext
function createMockCtx() {
  const registeredAgents: any[] = [];
  const registeredTools: any[] = [];
  return {
    agents: {
      register: (reg: any) => registeredAgents.push(reg),
      list: () => registeredAgents,
      get: (name: string) => registeredAgents.find(a => a.name === name),
      getResolvedPrompt: () => "",
      hasPromptOverride: () => false,
      getOrchestratorNames: () => new Set(),
    },
    tools: {
      register: (reg: any) => registeredTools.push(reg),
      list: () => registeredTools,
      get: (name: string) => registeredTools.find(t => t.name === name),
    },
    storage: {
      conversations: {} as any,
      memory: {} as any,
      skills: {} as any,
      tasks: {} as any,
      prompts: {} as any,
      audio: {} as any,
      commands: {
        save: async () => {},
        list: async () => [],
        get: async () => undefined,
        delete: async () => {},
      },
    },
    model: () => ({} as any),
    cards: { register: () => {}, get: () => undefined, list: () => [] },
    maxDelegationDepth: 5,
    defaultMaxSteps: 10,
    config: {} as any,
    _registeredAgents: registeredAgents,
    _registeredTools: registeredTools,
  };
}

describe("self-register", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  test("registerAgent collects agent config", () => {
    registerAgent({
      name: "test-agent",
      description: "A test agent",
      system: "You are a test agent",
      tools: {},
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    expect(ctx._registeredAgents).toHaveLength(1);
    expect(ctx._registeredAgents[0].name).toBe("test-agent");
    expect(ctx._registeredAgents[0].defaultSystem).toBe("You are a test agent");
  });

  test("registerTool collects tool config", () => {
    const mockTool = { execute: async () => "result" };
    registerTool({
      name: "test-tool",
      description: "A test tool",
      inputSchema: {} as any,
      tool: mockTool,
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    expect(ctx._registeredTools).toHaveLength(1);
    expect(ctx._registeredTools[0].name).toBe("test-tool");
  });

  test("registerAgent creates both json and sse handlers", () => {
    registerAgent({
      name: "handler-agent",
      description: "Agent with handlers",
      system: "You are helpful",
      tools: {},
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    const agent = ctx._registeredAgents[0];
    expect(agent.jsonHandler).toBeDefined();
    expect(agent.sseHandler).toBeDefined();
  });

  test("registerWithPlugin is idempotent (maps cleared after flush)", () => {
    registerAgent({
      name: "once-agent",
      description: "Should only register once",
      system: "test",
      tools: {},
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);
    registerWithPlugin(ctx as any); // second call

    expect(ctx._registeredAgents).toHaveLength(1);
  });

  test("multiple agents and tools register together", () => {
    registerAgent({ name: "a1", description: "A1", system: "s1", tools: {} });
    registerAgent({ name: "a2", description: "A2", system: "s2", tools: {} });
    registerTool({ name: "t1", description: "T1", inputSchema: {} as any, tool: {} });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    expect(ctx._registeredAgents).toHaveLength(2);
    expect(ctx._registeredTools).toHaveLength(1);
  });

  test("registerCommand stores command for later flush", () => {
    registerCommand({
      name: "summarize",
      description: "Summarize text",
      system: "You summarize things",
    });

    const ctx = createMockCtx();
    const savedCommands: any[] = [];
    ctx.storage.commands.save = async (cmd: any) => { savedCommands.push(cmd); };

    registerWithPlugin(ctx as any);

    expect(savedCommands).toHaveLength(1);
    expect(savedCommands[0].name).toBe("summarize");
  });

  test("agent format defaults to sse", () => {
    registerAgent({
      name: "default-format",
      description: "Test",
      system: "test",
      tools: {},
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    expect(ctx._registeredAgents[0].defaultFormat).toBe("sse");
  });

  test("agent format can be overridden to json", () => {
    registerAgent({
      name: "json-agent",
      description: "Test",
      system: "test",
      tools: {},
      format: "json",
    });

    const ctx = createMockCtx();
    registerWithPlugin(ctx as any);

    expect(ctx._registeredAgents[0].defaultFormat).toBe("json");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/core/test/self-register.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement self-register.ts**

Create `packages/core/src/registry/self-register.ts`:

```typescript
import type { PluginContext } from "../types.js";
import type { z } from "zod";
import { makeRegistryHandlers } from "./handler-factories.js";

// --- Config types ---

export interface AgentSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools: Record<string, any>;
  format?: "json" | "sse";
}

export interface ToolSelfRegConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
}

export interface CommandSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools?: string[];
  model?: string;
  format?: "json" | "sse";
}

export interface SkillSelfRegConfig {
  name: string;
  description: string;
}

// --- Module-level collectors ---

const agentConfigs = new Map<string, AgentSelfRegConfig>();
const toolConfigs = new Map<string, ToolSelfRegConfig>();
const commandConfigs = new Map<string, CommandSelfRegConfig>();
const skillConfigs = new Map<string, SkillSelfRegConfig>();

// --- Registration functions ---

export function registerAgent(config: AgentSelfRegConfig): void {
  agentConfigs.set(config.name, config);
}

export function registerTool(config: ToolSelfRegConfig): void {
  toolConfigs.set(config.name, config);
}

export function registerCommand(config: CommandSelfRegConfig): void {
  commandConfigs.set(config.name, config);
}

export function registerSkill(config: SkillSelfRegConfig): void {
  skillConfigs.set(config.name, config);
}

// --- Flush function ---

export function registerWithPlugin(ctx: PluginContext): void {
  // Register tools first (agents may reference them)
  for (const config of toolConfigs.values()) {
    ctx.tools.register({
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
      tool: config.tool,
      directExecute: config.directExecute,
      category: config.category,
    });
  }

  // Register agents with auto-created handlers
  for (const config of agentConfigs.values()) {
    const { sseHandler, jsonHandler } = makeRegistryHandlers(
      { tools: config.tools },
      ctx,
    );

    ctx.agents.register({
      name: config.name,
      description: config.description,
      toolNames: Object.keys(config.tools),
      defaultFormat: config.format ?? "sse",
      defaultSystem: config.system,
      tools: config.tools,
      sseHandler,
      jsonHandler,
    });
  }

  // Save commands to storage
  for (const config of commandConfigs.values()) {
    ctx.storage.commands?.save(config);
  }

  // Clear maps after flush (idempotent)
  agentConfigs.clear();
  toolConfigs.clear();
  commandConfigs.clear();
  skillConfigs.clear();
}

// --- Test helper ---

export function _resetForTesting(): void {
  agentConfigs.clear();
  toolConfigs.clear();
  commandConfigs.clear();
  skillConfigs.clear();
}
```

**Step 4: Add exports to core index**

In `packages/core/src/index.ts`, add:

```typescript
export {
  registerAgent,
  registerTool,
  registerCommand,
  registerSkill,
  registerWithPlugin,
} from "./registry/self-register.js";
export type {
  AgentSelfRegConfig,
  ToolSelfRegConfig,
  CommandSelfRegConfig,
  SkillSelfRegConfig,
} from "./registry/self-register.js";
```

**Step 5: Run tests**

```bash
bun test packages/core/test/self-register.test.ts
```

Expected: all tests pass.

**Step 6: Run full test suite and build**

```bash
bun run build
bun run --cwd packages/core test
bun run --cwd packages/hono test
```

Expected: all pass.

**Step 7: Commit**

```bash
git add packages/core/src/registry/self-register.ts packages/core/test/self-register.test.ts packages/core/src/index.ts
git commit -m "feat(core): add self-registration API (registerAgent, registerTool, registerCommand, registerSkill)"
```

---

### Task 3: Verify body-passing fix is in place

The body-passing fix was applied in a previous session. Verify it's correct in the source files before proceeding.

**Files:**
- Verify: `packages/core/src/registry/agent-registry.ts:4-7` — `body?` in AgentHandler options
- Verify: `packages/core/src/registry/handler-factories.ts:16,51` — `body: preParsedBody` destructuring
- Verify: `packages/hono/src/routes/agents/agents.routes.ts:268-288` — body parsed once, passed to handler

**Step 1: Read and verify all three files**

Check that:
- `AgentHandler` type includes `body?: Record<string, any>` in options
- Both `makeRegistryStreamHandler` and `makeRegistryJsonHandler` destructure `body: preParsedBody` and use `preParsedBody ?? await req.json()`
- The POST `/{agentName}` route parses `const body = await c.req.json()` once and passes `{ systemPrompt, memoryContext, body }` to the handler

**Step 2: Run build and tests**

```bash
bun run build
bun run --cwd packages/core test
bun run --cwd packages/hono test
```

Expected: all pass, no changes needed.

**Step 3: Commit if any corrections were needed**

```bash
git commit -m "fix(core): verify body-passing fix for double-read bug"
```

---

## Phase 2: Commands

### Task 4: Add CommandStore to storage interfaces

**Files:**
- Modify: `packages/core/src/storage/interfaces.ts` (add CommandRegistration type, CommandStore interface, update StorageProvider)
- Test: `packages/core/test/command-store.test.ts`

**Step 1: Write the failing test**

Create `packages/core/test/command-store.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";

describe("CommandStore (in-memory)", () => {
  test("save and get a command", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({
      name: "summarize",
      description: "Summarize text",
      system: "You summarize things concisely",
    });

    const cmd = await storage.commands.get("summarize");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("summarize");
    expect(cmd!.system).toBe("You summarize things concisely");
  });

  test("list commands", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({ name: "cmd1", description: "D1", system: "S1" });
    await storage.commands.save({ name: "cmd2", description: "D2", system: "S2" });

    const list = await storage.commands.list();
    expect(list).toHaveLength(2);
  });

  test("delete a command", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({ name: "temp", description: "D", system: "S" });
    await storage.commands.delete("temp");

    const cmd = await storage.commands.get("temp");
    expect(cmd).toBeUndefined();
  });

  test("save overwrites existing command", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({ name: "cmd", description: "V1", system: "S1" });
    await storage.commands.save({ name: "cmd", description: "V2", system: "S2" });

    const cmd = await storage.commands.get("cmd");
    expect(cmd!.description).toBe("V2");
  });

  test("list with scopeId filters by scope", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({ name: "global", description: "G", system: "S" });
    await storage.commands.save({ name: "scoped", description: "SC", system: "S" }, "user-1");

    const all = await storage.commands.list();
    const userOnly = await storage.commands.list("user-1");

    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0].name).toBe("scoped");
  });

  test("get with scopeId only returns scoped command", async () => {
    const storage = createMemoryStorage();
    await storage.commands.save({ name: "mine", description: "M", system: "S" }, "user-1");

    const found = await storage.commands.get("mine", "user-1");
    const notFound = await storage.commands.get("mine", "user-2");

    expect(found).toBeDefined();
    expect(notFound).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/core/test/command-store.test.ts
```

Expected: FAIL — `commands` not in storage.

**Step 3: Add types to interfaces.ts**

In `packages/core/src/storage/interfaces.ts`, add after the AudioStore interface:

```typescript
// --- Commands ---

export interface CommandRegistration {
  name: string;
  description: string;
  system: string;
  tools?: string[];
  model?: string;
  format?: "json" | "sse";
}

export interface CommandStore {
  list(scopeId?: string): Promise<CommandRegistration[]>;
  get(name: string, scopeId?: string): Promise<CommandRegistration | undefined>;
  save(command: CommandRegistration, scopeId?: string): Promise<void>;
  delete(name: string, scopeId?: string): Promise<void>;
}
```

Update `StorageProvider` to include commands:

```typescript
export interface StorageProvider {
  conversations: ConversationStore;
  memory: MemoryStore;
  skills: SkillStore;
  tasks: TaskStore;
  prompts: PromptStore;
  audio: AudioStore;
  commands: CommandStore;
}
```

**Step 4: Implement in-memory CommandStore**

Create `packages/core/src/storage/in-memory/command-store.ts`:

```typescript
import type { CommandRegistration, CommandStore } from "../interfaces.js";

export function createInMemoryCommandStore(): CommandStore {
  // key format: "{scopeId}:{name}" or ":{name}" for unscoped
  const commands = new Map<string, CommandRegistration>();

  function makeKey(name: string, scopeId?: string): string {
    return `${scopeId ?? ""}:${name}`;
  }

  return {
    async list(scopeId?: string) {
      const results: CommandRegistration[] = [];
      for (const [key, cmd] of commands) {
        if (scopeId === undefined || key.startsWith(`${scopeId}:`)) {
          results.push(cmd);
        }
      }
      return results;
    },
    async get(name, scopeId?) {
      return commands.get(makeKey(name, scopeId));
    },
    async save(command, scopeId?) {
      commands.set(makeKey(command.name, scopeId), command);
    },
    async delete(name, scopeId?) {
      commands.delete(makeKey(name, scopeId));
    },
  };
}
```

**Step 5: Wire into in-memory storage factory**

In `packages/core/src/storage/in-memory/index.ts`, import and add `createInMemoryCommandStore`:

```typescript
import { createInMemoryCommandStore } from "./command-store.js";

// Add to the returned object:
commands: createInMemoryCommandStore(),
```

**Step 6: Implement file-based CommandStore**

Create `packages/core/src/storage/file-storage/command-store.ts`:

```typescript
import { join } from "node:path";
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import type { CommandRegistration, CommandStore } from "../interfaces.js";

export function createCommandStore(dataDir: string): CommandStore {
  function getDir(scopeId?: string): string {
    return scopeId ? join(dataDir, "commands", scopeId) : join(dataDir, "commands");
  }

  function getPath(name: string, scopeId?: string): string {
    return join(getDir(scopeId), `${name}.json`);
  }

  return {
    async list(scopeId?) {
      const dir = getDir(scopeId);
      try {
        const files = await readdir(dir);
        const results: CommandRegistration[] = [];
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const content = await readFile(join(dir, file), "utf-8");
          results.push(JSON.parse(content));
        }
        return results;
      } catch {
        return [];
      }
    },
    async get(name, scopeId?) {
      try {
        const content = await readFile(getPath(name, scopeId), "utf-8");
        return JSON.parse(content);
      } catch {
        return undefined;
      }
    },
    async save(command, scopeId?) {
      const dir = getDir(scopeId);
      await mkdir(dir, { recursive: true });
      await writeFile(getPath(command.name, scopeId), JSON.stringify(command, null, 2));
    },
    async delete(name, scopeId?) {
      try {
        await unlink(getPath(name, scopeId));
      } catch { /* ignore if not found */ }
    },
  };
}
```

**Step 7: Wire into file storage factory**

In `packages/core/src/storage/file-storage/index.ts`, import and add `createCommandStore`:

```typescript
import { createCommandStore } from "./command-store.js";

// Add to the returned object:
commands: createCommandStore(dataDir),
```

**Step 8: Export CommandRegistration and CommandStore from core index**

In `packages/core/src/index.ts`, add to the storage type exports:

```typescript
export type { CommandRegistration, CommandStore } from "./storage/interfaces.js";
```

**Step 9: Run tests**

```bash
bun test packages/core/test/command-store.test.ts
bun run --cwd packages/core test
```

Expected: all pass.

**Step 10: Commit**

```bash
git add packages/core/src/storage/ packages/core/test/command-store.test.ts packages/core/src/index.ts
git commit -m "feat(core): add CommandStore with in-memory and file-based implementations"
```

---

### Task 5: Add command routes to hono

**Files:**
- Create: `packages/hono/src/routes/commands/commands.routes.ts`
- Modify: `packages/hono/src/plugin.ts` (mount routes)
- Test: `packages/hono/test/commands.test.ts`

**Step 1: Write the failing test**

Create `packages/hono/test/commands.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createAIPlugin } from "../src/plugin.js";

function createTestPlugin() {
  return createAIPlugin({
    model: () => ({ /* mock */ } as any),
  });
}

describe("command routes", () => {
  test("GET /commands returns empty list initially", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();
    const res = await plugin.app.request("/commands");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands).toEqual([]);
  });

  test("POST /commands creates a command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    const res = await plugin.app.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "summarize",
        description: "Summarize text",
        system: "You summarize things",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("summarize");
  });

  test("GET /commands/:name returns a specific command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    await plugin.app.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-cmd", description: "D", system: "S" }),
    });

    const res = await plugin.app.request("/commands/test-cmd");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("test-cmd");
  });

  test("GET /commands/:name returns 404 for missing", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();
    const res = await plugin.app.request("/commands/missing");
    expect(res.status).toBe(404);
  });

  test("DELETE /commands/:name removes command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    await plugin.app.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "to-delete", description: "D", system: "S" }),
    });

    const del = await plugin.app.request("/commands/to-delete", { method: "DELETE" });
    expect(del.status).toBe(200);

    const get = await plugin.app.request("/commands/to-delete");
    expect(get.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/hono/test/commands.test.ts
```

Expected: FAIL — routes don't exist.

**Step 3: Create commands routes**

Create `packages/hono/src/routes/commands/commands.routes.ts`:

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";

const commandSchema = z.object({
  name: z.string(),
  description: z.string(),
  system: z.string(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  format: z.enum(["json", "sse"]).optional(),
});

export function createCommandsRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();

  // GET / — List commands
  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Commands"],
      summary: "List all commands",
      responses: {
        200: {
          description: "List of commands",
          content: {
            "application/json": {
              schema: z.object({ commands: z.array(commandSchema) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const commands = await ctx.storage.commands.list(scopeId);
      return c.json({ commands });
    },
  );

  // GET /:name — Get command
  router.openapi(
    createRoute({
      method: "get",
      path: "/{name}",
      tags: ["Commands"],
      summary: "Get a command by name",
      request: {
        params: z.object({ name: z.string() }),
      },
      responses: {
        200: { description: "Command details", content: { "application/json": { schema: commandSchema } } },
        404: { description: "Not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    (async (c: any) => {
      const name = c.req.param("name");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const cmd = await ctx.storage.commands.get(name, scopeId);
      if (!cmd) return c.json({ error: `Command not found: ${name}` }, 404);
      return c.json(cmd);
    }) as any,
  );

  // POST / — Create or update command
  router.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["Commands"],
      summary: "Create or update a command",
      request: {
        body: { content: { "application/json": { schema: commandSchema } } },
      },
      responses: {
        200: { description: "Command saved", content: { "application/json": { schema: commandSchema } } },
      },
    }),
    async (c) => {
      const body = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      await ctx.storage.commands.save(body, scopeId);
      return c.json(body);
    },
  );

  // DELETE /:name — Delete command
  router.openapi(
    createRoute({
      method: "delete",
      path: "/{name}",
      tags: ["Commands"],
      summary: "Delete a command",
      request: {
        params: z.object({ name: z.string() }),
      },
      responses: {
        200: { description: "Command deleted", content: { "application/json": { schema: z.object({ deleted: z.boolean() }) } } },
      },
    }),
    (async (c: any) => {
      const name = c.req.param("name");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      await ctx.storage.commands.delete(name, scopeId);
      return c.json({ deleted: true });
    }) as any,
  );

  // POST /:name/run — Execute command as ad-hoc agent
  router.openapi(
    createRoute({
      method: "post",
      path: "/{name}/run",
      tags: ["Commands"],
      summary: "Run a command",
      request: {
        params: z.object({ name: z.string() }),
        body: { content: { "application/json": { schema: z.object({ message: z.string(), model: z.string().optional() }) } } },
      },
      responses: {
        200: { description: "Command result", content: { "application/json": { schema: z.any() } } },
        404: { description: "Command not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    (async (c: any) => {
      const name = c.req.param("name");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const cmd = await ctx.storage.commands.get(name, scopeId);
      if (!cmd) return c.json({ error: `Command not found: ${name}` }, 404);

      const body = await c.req.json();
      const format = (c.req.query("format") ?? cmd.format ?? "json") as "json" | "sse";

      // Resolve tool names to tool instances
      const tools: Record<string, any> = {};
      if (cmd.tools) {
        for (const toolName of cmd.tools) {
          const reg = ctx.tools.get(toolName);
          if (reg) tools[toolName] = reg.tool;
        }
      }

      if (format === "sse") {
        const { streamAgentResponse } = await import("@kitnai/core/streaming/stream-helpers.js");
        return streamAgentResponse(ctx, {
          system: cmd.system,
          tools,
          prompt: body.message,
          model: body.model ?? cmd.model,
          conversationId: `cmd_${Date.now()}`,
        });
      }

      const { runAgent } = await import("@kitnai/core/agents/run-agent.js");
      const result = await runAgent(ctx, { system: cmd.system, tools }, body.message, body.model ?? cmd.model);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any,
  );

  return router;
}
```

**Step 4: Mount in plugin.ts**

In `packages/hono/src/plugin.ts`, add import and mount:

```typescript
import { createCommandsRoutes } from "./routes/commands/commands.routes.js";

// Add after other route mounts (~line 96):
app.route("/commands", createCommandsRoutes(ctx));
```

**Step 5: Run tests**

```bash
bun test packages/hono/test/commands.test.ts
bun run --cwd packages/hono test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add packages/hono/src/routes/commands/ packages/hono/test/commands.test.ts packages/hono/src/plugin.ts
git commit -m "feat(hono): add /commands routes (CRUD + run)"
```

---

## Phase 3: scopeId on Storage

### Task 6: Add scopeId to existing storage interfaces

**Files:**
- Modify: `packages/core/src/storage/interfaces.ts` (add scopeId to ConversationStore, MemoryStore, AudioStore)
- Modify: `packages/core/src/storage/in-memory/memory-store.ts` (all in-memory stores)
- Modify: `packages/core/src/storage/file-storage/` (all file stores)
- Test: `packages/core/test/scope-storage.test.ts`

This is a large task. The approach is additive — `scopeId` is optional on every method, so existing code continues to work without changes.

**Step 1: Write the failing test**

Create `packages/core/test/scope-storage.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";

describe("scoped storage", () => {
  describe("ConversationStore", () => {
    test("list with scopeId returns only scoped conversations", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      await storage.conversations.append("conv-2", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-b");

      const userA = await storage.conversations.list("user-a");
      expect(userA).toHaveLength(1);
    });

    test("list without scopeId returns all", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      await storage.conversations.append("conv-2", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-b");

      const all = await storage.conversations.list();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("MemoryStore", () => {
    test("scoped memory entries are isolated", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "value-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key", "value-b", undefined, "user-b");

      const entriesA = await storage.memory.listEntries("ns", "user-a");
      expect(entriesA).toHaveLength(1);
      expect(entriesA[0].value).toBe("value-a");
    });
  });
});
```

**Step 2: Update ConversationStore interface**

In `packages/core/src/storage/interfaces.ts`, add `scopeId?` parameter to methods:

```typescript
export interface ConversationStore {
  get(id: string, scopeId?: string): Promise<Conversation | null>;
  list(scopeId?: string): Promise<ConversationSummary[]>;
  create(id: string, scopeId?: string): Promise<Conversation>;
  append(id: string, message: ConversationMessage, scopeId?: string): Promise<Conversation>;
  delete(id: string, scopeId?: string): Promise<boolean>;
  clear(id: string, scopeId?: string): Promise<Conversation>;
}
```

**Step 3: Update MemoryStore interface**

```typescript
export interface MemoryStore {
  listNamespaces(scopeId?: string): Promise<string[]>;
  listEntries(namespaceId: string, scopeId?: string): Promise<MemoryEntry[]>;
  saveEntry(namespaceId: string, key: string, value: string, context?: string, scopeId?: string): Promise<MemoryEntry>;
  getEntry(namespaceId: string, key: string, scopeId?: string): Promise<MemoryEntry | null>;
  deleteEntry(namespaceId: string, key: string, scopeId?: string): Promise<boolean>;
  clearNamespace(namespaceId: string, scopeId?: string): Promise<void>;
  loadMemoriesForIds(ids: string[], scopeId?: string): Promise<Array<MemoryEntry & { namespace: string }>>;
}
```

**Step 4: Update AudioStore interface**

```typescript
export interface AudioStore {
  saveAudio(buffer: Buffer | Uint8Array, mimeType: string, metadata?: Record<string, unknown>, scopeId?: string): Promise<AudioEntry>;
  getAudio(id: string, scopeId?: string): Promise<{ entry: AudioEntry; data: Buffer } | null>;
  deleteAudio(id: string, scopeId?: string): Promise<boolean>;
  listAudio(scopeId?: string): Promise<AudioEntry[]>;
  cleanupOlderThan(maxAgeMs: number, scopeId?: string): Promise<number>;
}
```

**Step 5: Update in-memory implementations**

Update each in-memory store to accept and use scopeId. The pattern is:
- For key-based stores: prefix keys with `{scopeId}:` when scopeId is provided
- For list operations: filter by prefix when scopeId is provided
- When scopeId is undefined, behave as before (all entries)

This is mechanical. Update each store in `packages/core/src/storage/in-memory/`:
- `memory-store.ts` (the existing in-memory memory store file that exports `createMemoryStorage`)

**Step 6: Update file-based implementations**

Same pattern for file storage: scopeId becomes a subdirectory.
- Without scope: `data/conversations/conv_123.json`
- With scope: `data/conversations/user-a/conv_123.json`

Update each store in `packages/core/src/storage/file-storage/`.

**Step 7: Run tests**

```bash
bun test packages/core/test/scope-storage.test.ts
bun run --cwd packages/core test
```

Expected: all pass.

**Step 8: Commit**

```bash
git add packages/core/src/storage/
git commit -m "feat(core): add optional scopeId to conversation, memory, command, and audio stores"
```

---

### Task 7: Thread scopeId through hono routes

**Files:**
- Modify: `packages/hono/src/routes/conversations/conversations.routes.ts`
- Modify: `packages/hono/src/routes/memory/memory.routes.ts` and `memory.handlers.ts`
- Modify: `packages/hono/src/routes/agents/agents.routes.ts`

**Step 1: Add scopeId extraction pattern**

In each route file, extract scopeId from the request header:

```typescript
const scopeId = c.req.header("X-Scope-Id") || undefined;
```

Pass it through to all storage calls.

**Step 2: Update conversation routes**

Thread `scopeId` through list, get, append, delete calls.

**Step 3: Update memory routes and handlers**

Thread `scopeId` through all memory operations.

**Step 4: Update agent routes**

Thread `scopeId` through conversation persistence in the agent POST handler.

**Step 5: Run tests**

```bash
bun run --cwd packages/hono test
```

Expected: all existing tests pass (they don't set X-Scope-Id, so behavior is unchanged).

**Step 6: Commit**

```bash
git add packages/hono/src/routes/
git commit -m "feat(hono): thread scopeId from X-Scope-Id header through all scoped routes"
```

---

## Phase 4: CLI Auto-Wiring

### Task 8: Add barrel file management to CLI

**Files:**
- Create: `packages/cli/src/installers/barrel-manager.ts`
- Modify: `packages/cli/src/commands/add.ts`
- Modify: `packages/cli/src/commands/remove.ts`
- Test: `packages/cli/test/barrel-manager.test.ts`

**Step 1: Write the failing test**

Create `packages/cli/test/barrel-manager.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  createBarrelFile,
  addImportToBarrel,
  removeImportFromBarrel,
  parseBarrelFile,
} from "../src/installers/barrel-manager.js";

describe("barrel-manager", () => {
  test("createBarrelFile generates initial barrel content", () => {
    const content = createBarrelFile();
    expect(content).toContain('export { registerWithPlugin }');
    expect(content).toContain('@kitnai/core');
  });

  test("addImportToBarrel adds import before export line", () => {
    const initial = createBarrelFile();
    const updated = addImportToBarrel(initial, "./agents/weather-agent.ts");
    expect(updated).toContain('import "./agents/weather-agent.ts"');
    // Import should be before the export
    const importIdx = updated.indexOf('import "./agents/weather-agent.ts"');
    const exportIdx = updated.indexOf('export {');
    expect(importIdx).toBeLessThan(exportIdx);
  });

  test("addImportToBarrel is idempotent", () => {
    const initial = createBarrelFile();
    const once = addImportToBarrel(initial, "./agents/weather-agent.ts");
    const twice = addImportToBarrel(once, "./agents/weather-agent.ts");
    expect(once).toBe(twice);
  });

  test("removeImportFromBarrel removes the import line", () => {
    const initial = createBarrelFile();
    const added = addImportToBarrel(initial, "./agents/weather-agent.ts");
    const removed = removeImportFromBarrel(added, "./agents/weather-agent.ts");
    expect(removed).not.toContain("weather-agent");
    expect(removed).toContain('export { registerWithPlugin }');
  });

  test("parseBarrelFile extracts import paths", () => {
    const content = [
      'import "./agents/weather-agent.ts";',
      'import "./tools/weather.ts";',
      'export { registerWithPlugin } from "@kitnai/core";',
    ].join("\n");
    const imports = parseBarrelFile(content);
    expect(imports).toEqual(["./agents/weather-agent.ts", "./tools/weather.ts"]);
  });

  test("multiple imports maintain order", () => {
    let content = createBarrelFile();
    content = addImportToBarrel(content, "./agents/a.ts");
    content = addImportToBarrel(content, "./tools/b.ts");
    content = addImportToBarrel(content, "./agents/c.ts");
    const imports = parseBarrelFile(content);
    expect(imports).toEqual(["./agents/a.ts", "./tools/b.ts", "./agents/c.ts"]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/cli/test/barrel-manager.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement barrel-manager.ts**

Create `packages/cli/src/installers/barrel-manager.ts`:

```typescript
const EXPORT_LINE = 'export { registerWithPlugin } from "@kitnai/core";';
const BARREL_COMMENT = "// Managed by kitn CLI — components auto-imported below";

export function createBarrelFile(): string {
  return `${BARREL_COMMENT}\n${EXPORT_LINE}\n`;
}

export function addImportToBarrel(content: string, importPath: string): string {
  const importLine = `import "${importPath}";`;

  // Idempotent — skip if already present
  if (content.includes(importLine)) return content;

  // Insert before the export line
  const exportIndex = content.indexOf(EXPORT_LINE);
  if (exportIndex === -1) {
    // No export line found — append both
    return `${content.trimEnd()}\n${importLine}\n${EXPORT_LINE}\n`;
  }

  const before = content.slice(0, exportIndex);
  const after = content.slice(exportIndex);
  return `${before}${importLine}\n${after}`;
}

export function removeImportFromBarrel(content: string, importPath: string): string {
  const importLine = `import "${importPath}";`;
  return content
    .split("\n")
    .filter((line) => line.trim() !== importLine)
    .join("\n");
}

export function parseBarrelFile(content: string): string[] {
  const imports: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^import\s+["'](.+)["'];?\s*$/);
    if (match) imports.push(match[1]);
  }
  return imports;
}
```

**Step 4: Run tests**

```bash
bun test packages/cli/test/barrel-manager.test.ts
```

Expected: all pass.

**Step 5: Commit**

```bash
git add packages/cli/src/installers/barrel-manager.ts packages/cli/test/barrel-manager.test.ts
git commit -m "feat(cli): add barrel file manager for auto-wiring component imports"
```

---

### Task 9: Integrate barrel management into kitn add and kitn remove

**Files:**
- Modify: `packages/cli/src/commands/add.ts`
- Modify: `packages/cli/src/commands/remove.ts`

**Step 1: Update add.ts**

After writing component files, add barrel management:

1. Determine if the component type is barrel-eligible (`kitn:agent`, `kitn:tool`, `kitn:command`, `kitn:skill`)
2. Compute the import path relative to the barrel file (e.g., `./agents/weather-agent.ts`)
3. Read the barrel file at `{aliases.base}/index.ts`
4. If barrel doesn't exist and this is a `kitn:package` install for core, create it with `createBarrelFile()`
5. Call `addImportToBarrel()` and write back
6. On first barrel creation, print the setup hint

The setup hint:

```typescript
p.note(
  [
    `import { createAIPlugin } from "@kitnai/hono";`,
    `import { registerWithPlugin } from "./ai";`,
    ``,
    `const plugin = createAIPlugin({`,
    `  model: (model) => yourProvider(model ?? "default-model"),`,
    `});`,
    ``,
    `registerWithPlugin(plugin);`,
    `app.route("/api", plugin.app);`,
  ].join("\n"),
  "Add this to your app setup",
);
```

**Step 2: Update remove.ts**

After deleting component files, remove the import from the barrel:

1. Compute the import path the same way as add
2. Read the barrel file
3. Call `removeImportFromBarrel()` and write back

**Step 3: Run full CLI tests**

```bash
bun run --cwd packages/cli test
```

Expected: all existing tests pass. Barrel tests pass.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/add.ts packages/cli/src/commands/remove.ts
git commit -m "feat(cli): auto-wire barrel imports on kitn add/remove"
```

---

## Phase 5: Registry Component Templates

### Task 10: Update registry component source templates

**Files:**
- Modify: Published registry components (weather-agent, weather-tool, etc.)
- These live in the registry repo, not this monorepo

**Step 1: Update component templates to include self-registration calls**

Each agent template should end with a `registerAgent()` call. Each tool template should end with a `registerTool()` call. Import the registration function from `@kitnai/core`.

Example for weather-agent:

```typescript
import { registerAgent } from "@kitnai/core";
// ... tool imports, SYSTEM_PROMPT definition ...

registerAgent({
  name: "weather",
  description: "Weather specialist — fetches and presents weather data",
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
});
```

Example for weather-tool:

```typescript
import { registerTool } from "@kitnai/core";
import { z } from "zod";
// ... weatherTool definition ...

registerTool({
  name: "getWeather",
  description: "Get current weather for a location",
  inputSchema: z.object({ location: z.string() }),
  tool: weatherTool,
});
```

**Step 2: Rebuild and publish registry**

```bash
kitn build
```

**Step 3: Test end-to-end**

In a fresh project:
```bash
kitn init
kitn add core
kitn add hono
kitn add weather-agent
```

Verify:
- `src/ai/index.ts` exists with import for weather-agent
- Weather agent self-registers when barrel is imported
- Setup hint was printed on first install

---

## Summary of All Commits

| Phase | Commit | Message |
|-------|--------|---------|
| 1 | 1 | `refactor: rename getModel to model across codebase` |
| 1 | 2 | `feat(core): add self-registration API` |
| 1 | 3 | `fix(core): verify body-passing fix` |
| 2 | 4 | `feat(core): add CommandStore` |
| 2 | 5 | `feat(hono): add /commands routes` |
| 3 | 6 | `feat(core): add scopeId to storage` |
| 3 | 7 | `feat(hono): thread scopeId through routes` |
| 4 | 8 | `feat(cli): add barrel file manager` |
| 4 | 9 | `feat(cli): auto-wire barrel on add/remove` |
| 5 | 10 | `feat(registry): add self-registration to component templates` |
