# KitnClaw Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build KitnClaw — a general-purpose AI assistant (like OpenClaw) built on @kitnai/core, with a terminal TUI, messaging channels (Discord/Telegram/WhatsApp), dynamic tool/agent creation, libSQL memory, and tiered permissions.

**Architecture:** Single long-running Bun gateway process. Multiple clients (terminal TUI, messaging bots) connect to it. Each gets its own session with serial execution. `@kitnai/core` provides the agent runtime, tool/agent registries, and storage. OpenTUI for the terminal interface. Channels are registry components.

**Tech Stack:** Bun, TypeScript, @kitnai/core, OpenTUI (@opentui/react), libSQL (@libsql/client), Vercel AI SDK v6, discord.js, grammY (Telegram), Baileys (WhatsApp)

**Design doc:** `docs/plans/2026-03-02-kitnclaw-design.md`

---

# Epic 1 (V1): Core Gateway + Terminal + Channels

The complete first release. A working personal AI assistant with terminal TUI, Discord, Telegram, and WhatsApp channels, built-in tools, permissions, sessions, memory, and dynamic creation.

---

## Phase 1: Package Scaffolding + Gateway Core

Stand up the `packages/claw/` package, wire it into the monorepo, and get a minimal gateway process running.

### Task 1.1: Create package structure

**Files:**
- Create: `packages/claw/package.json`
- Create: `packages/claw/tsconfig.json`
- Create: `packages/claw/tsup.config.ts`
- Create: `packages/claw/src/index.ts`
- Modify: `package.json` (root — add to workspaces)

**Step 1:** Create `packages/claw/package.json`:

```json
{
  "name": "@kitnai/claw",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "kitnclaw": "./dist/index.js",
    "kclaw": "./dist/index.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "bun run src/index.ts"
  },
  "dependencies": {
    "@kitnai/core": "workspace:*",
    "@kitnai/cli-core": "workspace:*",
    "@libsql/client": "^0.15.0",
    "commander": "^13.1.0",
    "ai": "^6.0.91",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  }
}
```

**Step 2:** Create `packages/claw/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3:** Create `packages/claw/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: true,
  banner: { js: '#!/usr/bin/env bun' },
});
```

**Step 4:** Create minimal `packages/claw/src/index.ts`:

```ts
import { Command } from "commander";

const program = new Command()
  .name("kitnclaw")
  .description("KitnClaw — AI assistant powered by kitn")
  .version("0.1.0");

program
  .command("start")
  .description("Start the KitnClaw gateway")
  .action(async () => {
    const { startGateway } = await import("./gateway/start.js");
    await startGateway();
  });

await program.parseAsync();
```

**Step 5:** Add to root `package.json` workspaces and add dev script.

**Step 6:** Run `bun install` to link the new workspace package.

**Step 7:** Commit.

```bash
git add packages/claw/ package.json bun.lock
git commit -m "feat(claw): scaffold @kitnai/claw package"
```

### Task 1.2: Config system

**Files:**
- Create: `packages/claw/src/config/schema.ts`
- Create: `packages/claw/src/config/io.ts`
- Test: `packages/claw/test/config.test.ts`

**Step 1:** Write test for config loading:

```ts
// packages/claw/test/config.test.ts
import { describe, test, expect } from "bun:test";
import { parseConfig, DEFAULT_CONFIG } from "../src/config/schema.js";

describe("config", () => {
  test("parses valid config", () => {
    const config = parseConfig({
      provider: { type: "openrouter", apiKey: "test" },
      model: "openai/gpt-4o-mini",
    });
    expect(config.model).toBe("openai/gpt-4o-mini");
  });

  test("applies defaults", () => {
    const config = parseConfig({});
    expect(config.channels.terminal.enabled).toBe(true);
    expect(config.permissions.trusted).toEqual([]);
  });

  test("rejects invalid provider", () => {
    expect(() => parseConfig({ provider: { type: "invalid" } })).toThrow();
  });
});
```

**Step 2:** Run test to verify it fails.

**Step 3:** Create `packages/claw/src/config/schema.ts` — Zod schema for `kitnclaw.json`:

```ts
import { z } from "zod";

const providerSchema = z.object({
  type: z.enum(["openrouter", "openai", "anthropic", "google", "ollama", "custom"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const channelConfigSchema = z.object({
  terminal: z.object({ enabled: z.boolean().default(true) }).default({}),
  discord: z.object({ token: z.string(), enabled: z.boolean().default(true) }).optional(),
  telegram: z.object({ token: z.string(), enabled: z.boolean().default(true) }).optional(),
  whatsapp: z.object({ enabled: z.boolean().default(true) }).optional(),
}).default({});

const permissionsSchema = z.object({
  trusted: z.array(z.string()).default([]),
  requireConfirmation: z.array(z.string()).default([]),
  denied: z.array(z.string()).default([]),
}).default({});

const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

export const configSchema = z.object({
  provider: providerSchema.optional(),
  model: z.string().default("openai/gpt-4o-mini"),
  channels: channelConfigSchema,
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
  permissions: permissionsSchema,
  registries: z.record(z.string(), z.string()).default({
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
  }),
  gateway: z.object({
    port: z.number().default(18800),
    bind: z.enum(["loopback", "lan"]).default("loopback"),
  }).default({}),
});

export type ClawConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: ClawConfig = configSchema.parse({});

export function parseConfig(raw: unknown): ClawConfig {
  return configSchema.parse(raw);
}
```

**Step 4:** Create `packages/claw/src/config/io.ts` — read/write config:

```ts
import { readFile, writeFile, mkdir, chmod } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { parseConfig, type ClawConfig } from "./schema.js";

export const CLAW_HOME = join(homedir(), ".kitnclaw");
export const CONFIG_PATH = join(CLAW_HOME, "kitnclaw.json");

export async function ensureClawHome(): Promise<void> {
  await mkdir(CLAW_HOME, { recursive: true });
  await mkdir(join(CLAW_HOME, "sessions"), { recursive: true });
  await mkdir(join(CLAW_HOME, "memory"), { recursive: true });
  await mkdir(join(CLAW_HOME, "workspace", "agents"), { recursive: true });
  await mkdir(join(CLAW_HOME, "workspace", "tools"), { recursive: true });
  await mkdir(join(CLAW_HOME, "workspace", "skills"), { recursive: true });
  await mkdir(join(CLAW_HOME, "credentials"), { recursive: true });
  await mkdir(join(CLAW_HOME, "logs"), { recursive: true });
  // Secure credentials directory
  try { await chmod(join(CLAW_HOME, "credentials"), 0o700); } catch {}
}

export async function loadConfig(): Promise<ClawConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return parseConfig(JSON.parse(raw));
  } catch {
    return parseConfig({});
  }
}

export async function saveConfig(config: ClawConfig): Promise<void> {
  await ensureClawHome();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  try { await chmod(CONFIG_PATH, 0o600); } catch {}
}
```

**Step 5:** Run tests, verify pass. Commit.

### Task 1.3: Gateway startup + @kitnai/core plugin

**Files:**
- Create: `packages/claw/src/gateway/start.ts`
- Create: `packages/claw/src/gateway/create-plugin.ts`
- Create: `packages/claw/src/gateway/model-factory.ts`

**Step 1:** Create `packages/claw/src/gateway/model-factory.ts` — creates AI SDK model from config:

```ts
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/schema.js";

export function createModelFactory(config: ClawConfig): (id?: string) => LanguageModel {
  return (id?: string) => {
    const modelId = id ?? config.model;
    const provider = config.provider;

    if (!provider) {
      throw new Error(
        "No AI provider configured. Run `kitnclaw setup` or edit ~/.kitnclaw/kitnclaw.json"
      );
    }

    // Dynamic import based on provider type
    // These are loaded at runtime so they're optional deps
    switch (provider.type) {
      case "openrouter": {
        const { createOpenRouter } = require("@openrouter/ai-sdk-provider");
        return createOpenRouter({ apiKey: provider.apiKey })(modelId);
      }
      case "openai": {
        const { createOpenAI } = require("@ai-sdk/openai");
        return createOpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl })(modelId);
      }
      case "anthropic": {
        const { createAnthropic } = require("@ai-sdk/anthropic");
        return createAnthropic({ apiKey: provider.apiKey })(modelId);
      }
      case "google": {
        const { createGoogleGenerativeAI } = require("@ai-sdk/google");
        return createGoogleGenerativeAI({ apiKey: provider.apiKey })(modelId);
      }
      case "ollama": {
        const { createOpenAI } = require("@ai-sdk/openai");
        return createOpenAI({
          baseURL: provider.baseUrl ?? "http://localhost:11434/v1",
          apiKey: "ollama",
        })(modelId);
      }
      case "custom": {
        const { createOpenAI } = require("@ai-sdk/openai");
        return createOpenAI({
          baseURL: provider.baseUrl,
          apiKey: provider.apiKey,
        })(modelId);
      }
      default:
        throw new Error(`Unknown provider type: ${provider.type}`);
    }
  };
}
```

**Step 2:** Create `packages/claw/src/gateway/create-plugin.ts` — creates the @kitnai/core plugin:

```ts
import {
  AgentRegistry,
  ToolRegistry,
  CardRegistry,
  createMemoryStorage,
  type PluginContext,
  type StorageProvider,
} from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { createModelFactory } from "./model-factory.js";

export function createClawPlugin(config: ClawConfig): PluginContext {
  const model = createModelFactory(config);
  const storage: StorageProvider = createMemoryStorage();

  return {
    agents: new AgentRegistry(),
    tools: new ToolRegistry(),
    cards: new CardRegistry(),
    storage,
    model,
    maxDelegationDepth: 3,
    defaultMaxSteps: 10,
    config: { model, storage },
  };
}
```

**Step 3:** Create `packages/claw/src/gateway/start.ts`:

```ts
import { loadConfig, ensureClawHome } from "../config/io.js";
import { createClawPlugin } from "./create-plugin.js";

export async function startGateway() {
  console.log("[kitnclaw] Starting gateway...");

  // 1. Ensure home directory structure
  await ensureClawHome();

  // 2. Load config
  const config = await loadConfig();
  console.log(`[kitnclaw] Model: ${config.model}`);

  // 3. Create @kitnai/core plugin
  const ctx = createClawPlugin(config);
  console.log("[kitnclaw] Core plugin initialized");

  // 4. Register built-in tools (Phase 2)
  // 5. Load workspace components (Phase 6)
  // 6. Start channels (Phase 5)
  // 7. Start TUI (Phase 4)

  console.log("[kitnclaw] Gateway running. Press Ctrl+C to stop.");

  // Keep process alive
  await new Promise(() => {});
}
```

**Step 4:** Test manually: `bun run packages/claw/src/index.ts start`. Verify it starts and prints messages.

**Step 5:** Commit.

```bash
git commit -m "feat(claw): gateway startup with config and core plugin"
```

---

## Phase 2: Built-in Tools + Permission System

Register the core tools that make KitnClaw useful, and the permission layer that keeps it safe.

### Task 2.1: Permission manager

**Files:**
- Create: `packages/claw/src/permissions/manager.ts`
- Create: `packages/claw/src/permissions/categories.ts`
- Test: `packages/claw/test/permissions.test.ts`

**Step 1:** Write tests:

```ts
import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../src/permissions/manager.js";

describe("PermissionManager", () => {
  test("safe tools auto-execute", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("file-read")).toBe("allow");
  });

  test("dangerous tools require confirmation", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    expect(pm.check("bash")).toBe("confirm");
  });

  test("trusted list overrides category", () => {
    const pm = new PermissionManager({ trusted: ["bash"], requireConfirmation: [], denied: [] });
    expect(pm.check("bash")).toBe("allow");
  });

  test("denied list blocks execution", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: ["bash"] });
    expect(pm.check("bash")).toBe("deny");
  });

  test("session trust persists within session", () => {
    const pm = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    pm.trustForSession("file-write");
    expect(pm.check("file-write")).toBe("allow");
  });
});
```

**Step 2:** Run tests, verify failure.

**Step 3:** Implement `categories.ts` — tool permission categories:

```ts
export type PermissionLevel = "safe" | "moderate" | "dangerous";

const TOOL_CATEGORIES: Record<string, PermissionLevel> = {
  "file-read": "safe",
  "file-search": "safe",
  "web-fetch": "safe",
  "web-search": "safe",
  "memory-search": "safe",
  "memory-save": "safe",
  "kitn-registry-search": "safe",
  "file-write": "moderate",
  "kitn-add": "moderate",
  "create-tool": "moderate",
  "create-agent": "moderate",
  "bash": "dangerous",
  "send-message": "dangerous",
  "file-delete": "dangerous",
};

export function getToolCategory(toolName: string): PermissionLevel {
  return TOOL_CATEGORIES[toolName] ?? "moderate";
}
```

**Step 4:** Implement `manager.ts`:

```ts
import { getToolCategory } from "./categories.js";

export type PermissionDecision = "allow" | "confirm" | "deny";

interface PermissionsConfig {
  trusted: string[];
  requireConfirmation: string[];
  denied: string[];
}

export class PermissionManager {
  private config: PermissionsConfig;
  private sessionTrusted = new Set<string>();

  constructor(config: PermissionsConfig) {
    this.config = config;
  }

  check(toolName: string): PermissionDecision {
    if (this.config.denied.includes(toolName)) return "deny";
    if (this.config.trusted.includes(toolName)) return "allow";
    if (this.sessionTrusted.has(toolName)) return "allow";

    const category = getToolCategory(toolName);
    switch (category) {
      case "safe": return "allow";
      case "moderate": return "confirm";
      case "dangerous": return "confirm";
    }
  }

  trustForSession(toolName: string): void {
    this.sessionTrusted.add(toolName);
  }

  clearSessionTrust(): void {
    this.sessionTrusted.clear();
  }
}
```

**Step 5:** Run tests, verify pass. Commit.

### Task 2.2: Built-in tools — file operations

**Files:**
- Create: `packages/claw/src/tools/file-read.ts`
- Create: `packages/claw/src/tools/file-write.ts`
- Create: `packages/claw/src/tools/file-search.ts`
- Create: `packages/claw/src/tools/register-builtin.ts`
- Test: `packages/claw/test/tools/file-tools.test.ts`

Implement `file-read`, `file-write`, `file-search` (glob + grep) as @kitnai/core tools using `registerTool()`. Each tool uses Node.js `fs` APIs.

**Key pattern** — each tool file exports a config object:

```ts
// packages/claw/src/tools/file-read.ts
import { tool } from "ai";
import { z } from "zod";
import { readFile } from "fs/promises";

export const fileReadTool = tool({
  description: "Read the contents of a file at the given path",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative file path"),
    encoding: z.enum(["utf-8", "base64"]).default("utf-8").describe("File encoding"),
  }),
  execute: async ({ path, encoding }) => {
    const content = await readFile(path, encoding as BufferEncoding);
    return { path, content, size: content.length };
  },
});
```

`register-builtin.ts` registers all built-in tools with the PluginContext.

### Task 2.3: Built-in tools — bash, web-fetch, web-search

**Files:**
- Create: `packages/claw/src/tools/bash.ts`
- Create: `packages/claw/src/tools/web-fetch.ts`
- Create: `packages/claw/src/tools/web-search.ts`
- Test: `packages/claw/test/tools/bash-tool.test.ts`

`bash` tool: Uses `Bun.spawn()` / `child_process.spawn()` with timeout (30s default), captures stdout/stderr. The permission manager intercepts before execution.

`web-fetch` tool: Uses global `fetch()` to retrieve URL content, strips HTML to markdown.

`web-search` tool: Uses a free search API (DuckDuckGo Instant Answer API or similar).

### Task 2.4: Built-in tools — memory + registry + dynamic creation

**Files:**
- Create: `packages/claw/src/tools/memory-tools.ts`
- Create: `packages/claw/src/tools/registry-tools.ts`
- Create: `packages/claw/src/tools/create-tools.ts`

`memory-search` / `memory-save`: Wraps the libSQL memory store (Phase 3).

`kitn-registry-search` / `kitn-add`: Calls cli-core's `listComponents()` and `addComponents()`.

`create-tool` / `create-agent`: Writes TypeScript source files to `~/.kitnclaw/workspace/tools/` or `workspace/agents/`. Uses kitn's self-registration pattern. Hot-reload (Phase 6) picks them up.

### Task 2.5: Permission-wrapped tool execution

**Files:**
- Create: `packages/claw/src/agent/wrapped-tools.ts`

Create a `wrapToolsWithPermissions()` function that intercepts tool calls. For each tool call:
1. Check `PermissionManager.check(toolName)`
2. If `"allow"` → execute immediately
3. If `"confirm"` → emit a permission request event (TUI/channel shows prompt, waits for user response)
4. If `"deny"` → return error to the agent

This wraps the raw AI SDK tools before passing them to `runAgent()`.

**Commit after each task in this phase.**

---

## Phase 3: Session Persistence + Memory (libSQL)

### Task 3.1: libSQL session store

**Files:**
- Create: `packages/claw/src/sessions/store.ts`
- Create: `packages/claw/src/sessions/types.ts`
- Test: `packages/claw/test/sessions.test.ts`

JSONL-based session persistence. Each session is a file in `~/.kitnclaw/sessions/`:

```
terminal-session-abc123.jsonl
discord-user-456.jsonl
```

Each line is a JSON event: `{type: "user"|"assistant"|"tool", ...}`.

The session store implements `ConversationStore` from @kitnai/core so it plugs directly into the existing storage system.

### Task 3.2: libSQL memory store

**Files:**
- Create: `packages/claw/src/memory/store.ts`
- Create: `packages/claw/src/memory/embeddings.ts`
- Test: `packages/claw/test/memory.test.ts`

Create a `MemoryStore` implementation backed by libSQL with native vector search:

- **Table: `memories`** — `id`, `namespace`, `key`, `value`, `context`, `embedding` (vector), `created_at`, `updated_at`
- **Vector column**: `F32_BLOB(1536)` (OpenAI embedding dimensions, configurable)
- **FTS5 index**: On `value` and `context` columns for keyword search
- **Hybrid search**: Combine cosine similarity score + BM25 keyword score

Embeddings generated via the configured AI provider (most support embedding models).

### Task 3.3: Session manager (serial queue)

**Files:**
- Create: `packages/claw/src/sessions/manager.ts`

Manages active sessions. Each session gets a serial task queue — one message at a time. This prevents race conditions from concurrent messages (critical lesson from OpenClaw).

```ts
class SessionManager {
  private queues = new Map<string, Promise<void>>();

  async enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task, task); // always chain, even on error
    this.queues.set(sessionId, next);
    return next;
  }
}
```

---

## Phase 4: Terminal UI (OpenTUI)

### Task 4.1: OpenTUI setup + basic rendering

**Files:**
- Create: `packages/claw/src/tui/index.tsx`
- Create: `packages/claw/src/tui/App.tsx`
- Create: `packages/claw/src/tui/components/Header.tsx`
- Modify: `packages/claw/package.json` (add @opentui/core, @opentui/react, react deps)

Set up OpenTUI React renderer. Create the root `App` component with a `Header` showing branding and current model. Verify it renders in the terminal.

### Task 4.2: Messages component

**Files:**
- Create: `packages/claw/src/tui/components/Messages.tsx`
- Create: `packages/claw/src/tui/components/ToolCard.tsx`

Scrollable message list with:
- User messages (plain text)
- Assistant messages (markdown rendering via OpenTUI's `<markdown>`)
- Tool call cards (name, input, status, result)
- Sticky scroll-to-bottom

### Task 4.3: Input component

**Files:**
- Create: `packages/claw/src/tui/components/Input.tsx`
- Create: `packages/claw/src/tui/components/CommandPalette.tsx`

Multi-line text input with:
- Submit on Enter (Shift+Enter for newline)
- Slash command detection → command palette overlay
- Ctrl+C clears input, double Ctrl+C exits
- Ctrl+Q quits

### Task 4.4: Permission prompt component

**Files:**
- Create: `packages/claw/src/tui/components/PermissionPrompt.tsx`

Inline permission prompt that pauses the agent response:
```
  ⚠ bash({ command: "rm -rf /tmp/test" }) requires confirmation
  [Y]es / [N]o / [A]lways trust this tool
```

User response feeds back into the permission-wrapped tool execution.

### Task 4.5: Slash commands

**Files:**
- Create: `packages/claw/src/tui/commands/index.ts`

Implement slash commands: `/model`, `/session`, `/add`, `/skills`, `/channels`, `/permissions`, `/clear`, `/help`, `/exit`.

### Task 4.6: Wire TUI to gateway

**Files:**
- Modify: `packages/claw/src/gateway/start.ts`
- Create: `packages/claw/src/tui/terminal-channel.ts`

The terminal TUI is a channel. When the gateway starts with `terminal.enabled: true`, it launches the OpenTUI renderer and creates a terminal channel that:
- Sends user input to the session manager
- Receives agent responses and tool calls
- Renders permission prompts inline

---

## Phase 5: Channel Abstraction + Messaging Platforms

### Task 5.1: Channel interface

**Files:**
- Create: `packages/claw/src/channels/types.ts`
- Create: `packages/claw/src/channels/manager.ts`

Define the `Channel`, `InboundMessage`, `OutboundMessage` interfaces (from design doc). Create `ChannelManager` that:
- Registers channels
- Routes inbound messages to the session manager
- Routes outbound responses to the correct channel

### Task 5.2: Discord channel (registry component)

**Files:**
- Create: `registry/components/channels/discord-channel/discord-channel.ts`
- Create: `registry/components/channels/discord-channel/manifest.json`

Discord bot using `discord.js`. Implements the `Channel` interface. Handles:
- Direct messages → new session
- Server mentions → threaded session
- Markdown → Discord embed conversion
- Attachment support (images, files)

**Registry type**: `kitn:channel` (may need to add this as a new component type in cli-core).

### Task 5.3: Telegram channel (registry component)

**Files:**
- Create: `registry/components/channels/telegram-channel/telegram-channel.ts`
- Create: `registry/components/channels/telegram-channel/manifest.json`

Telegram bot using `grammY`. Implements the `Channel` interface. Handles:
- Private messages → session per user
- Group mentions → session per group
- Markdown → Telegram MarkdownV2 conversion
- Inline keyboards for permission prompts

### Task 5.4: WhatsApp channel (registry component)

**Files:**
- Create: `registry/components/channels/whatsapp-channel/whatsapp-channel.ts`
- Create: `registry/components/channels/whatsapp-channel/manifest.json`

WhatsApp bridge using `@whiskeysockets/baileys` (same library OpenClaw uses). Implements the `Channel` interface. Handles:
- QR code pairing flow
- Message session routing
- Media attachments
- WhatsApp formatting limitations (no markdown, limited rich text)

### Task 5.5: Wire channels to gateway

**Files:**
- Modify: `packages/claw/src/gateway/start.ts`

During gateway startup, read channel config and start enabled channels. Each channel:
1. Connects (Discord login, Telegram polling, WhatsApp QR)
2. Registers with ChannelManager
3. Begins receiving messages → SessionManager → Agent → Response → Channel

---

## Phase 6: Hot-Reload + Dynamic Self-Modification

### Task 6.1: File watcher

**Files:**
- Create: `packages/claw/src/gateway/watcher.ts`

Watch `~/.kitnclaw/workspace/` for file changes. On change:
1. Detect file type (agent, tool, skill) from directory
2. For `.ts` files: invalidate Bun's module cache, re-import, re-register with @kitnai/core
3. For `.md` files (skills): reload into skill store
4. Log the change

Uses `fs.watch()` with debouncing.

### Task 6.2: Dynamic tool creation

**Files:**
- Modify: `packages/claw/src/tools/create-tools.ts`

The `create-tool` tool:
1. Agent provides: name, description, input schema, implementation logic
2. Tool generates a TypeScript file using kitn's `registerTool()` pattern
3. Writes to `~/.kitnclaw/workspace/tools/{name}.ts`
4. File watcher picks it up and registers it
5. Returns confirmation to the agent

Similarly for `create-agent`.

### Task 6.3: Registry integration

**Files:**
- Modify: `packages/claw/src/tools/registry-tools.ts`

The `kitn-add` tool:
1. Agent calls `kitn-add({ component: "weather-tool" })`
2. Tool calls cli-core's `addComponents()` with `cwd` set to the workspace
3. Components install to the workspace
4. File watcher picks them up
5. Agent can immediately use the new tools

---

## Phase 7: Deprecate Chat Service

### Task 7.1: Remove chat-service package

**Files:**
- Delete: `packages/chat-service/` (entire directory)
- Modify: `package.json` (root — remove from workspaces)

### Task 7.2: Remove CLI commands

**Files:**
- Modify: `packages/cli/src/index.ts` — remove `kitn chat`/`kitn code` command
- Delete: `packages/cli/src/commands/chat.ts`
- Modify: `packages/cli/src/index.ts` — remove `kitn config` command
- Delete: `packages/cli/src/commands/config.ts`

### Task 7.3: Clean up references

**Files:**
- Modify: `CLAUDE.md` — remove chat-service references
- Modify: any test files that reference chat

**Commit:**
```bash
git commit -m "chore: deprecate chat-service and kitn chat/config commands"
```

---

## Phase 8: Agent Loop + System Prompt + Integration

### Task 8.1: Agent loop wrapper

**Files:**
- Create: `packages/claw/src/agent/loop.ts`

Wrap `@kitnai/core`'s `runAgent()` with KitnClaw-specific behavior:
1. Assemble system prompt (base + SOUL.md + relevant skills)
2. Load conversation history from session
3. Inject memory search results (relevant past conversations)
4. Wrap tools with permission manager
5. Call `runAgent(ctx, config, messages, model)`
6. Extract tool calls and results for display
7. Persist assistant response to session
8. Return structured response to the channel

### Task 8.2: System prompt assembly

**Files:**
- Create: `packages/claw/src/agent/system-prompt.ts`

Compose the system prompt from layered sources:
1. Base instructions (who you are, what tools you have)
2. `SOUL.md` personality (if exists in workspace)
3. Skill summaries (names + descriptions of all available skills)
4. Available tool list with descriptions
5. Current session context (channel type, user identity)

Progressive skill injection: full skill content is loaded only when the agent requests it or the skill name matches the user's query.

### Task 8.3: Setup wizard (first-run)

**Files:**
- Create: `packages/claw/src/commands/setup.ts`
- Modify: `packages/claw/src/index.ts`

`kitnclaw setup` — interactive first-run wizard:
1. Choose AI provider (OpenRouter, OpenAI, Anthropic, Google, Ollama, Custom)
2. Enter API key
3. Choose default model
4. Enable channels (Discord, Telegram, WhatsApp — ask for tokens)
5. Write `kitnclaw.json`

### Task 8.4: Integration testing

**Files:**
- Create: `packages/claw/test/integration/gateway.test.ts`
- Create: `packages/claw/test/integration/agent-loop.test.ts`

End-to-end tests:
- Gateway starts and stops cleanly
- Agent loop processes a message and returns a response
- Tool execution respects permissions
- Session persists across messages
- Memory save and recall works

### Task 8.5: Build + typecheck + manual testing

- `bun run --cwd packages/claw build`
- `bun run typecheck`
- Manual test: `kitnclaw setup` → `kitnclaw start` → chat in TUI
- Manual test: Add a tool from registry, verify it works
- Manual test: Ask agent to create a new tool, verify hot-reload works
- Test Discord/Telegram/WhatsApp channels if credentials available

**Commit and tag:**
```bash
git tag v0.1.0-claw
```

---

# Epic 2 (V2): Security, Remote Access, Web UI

Hardening and expanding access. These features build on the stable V1 foundation.

---

## Phase 1: Sandboxing

### Task 2.1.1: Permission system v2 — granular policies

Extend the permission manager with:
- **Per-tool argument validation**: e.g., `bash` allowed only for specific command prefixes
- **Per-channel permissions**: Different trust levels for terminal vs Discord vs Telegram
- **Rate limiting**: Max N dangerous tool calls per minute
- **Audit log**: All tool executions logged to `~/.kitnclaw/logs/audit.jsonl`

### Task 2.1.2: Process sandboxing — subprocess isolation

Investigate and implement lightweight sandboxing options (in priority order):
1. **Bun subprocess with restricted permissions** — `Bun.spawn()` with `cwd` restriction and env sanitization
2. **Node.js `vm` module** — V8 isolate for JS-only tools (no filesystem access)
3. **Docker/Podman opt-in** — for users who want full isolation. Tool execution proxied to a container.

### Task 2.1.3: Credential encryption

Encrypt API keys at rest in `~/.kitnclaw/credentials/` using OS keychain (macOS Keychain, Linux libsecret) or a passphrase-derived key. Never store plaintext API keys in config files.

---

## Phase 2: Remote Access

### Task 2.2.1: Tailscale/Headscale integration

Allow the gateway to bind to a Tailscale/Headscale network interface:
- Config: `gateway.bind: "tailnet"`
- Users access their KitnClaw from any device on their tailnet
- TUI connects to remote gateway via `kitnclaw connect <url>`
- No port forwarding, no public exposure

### Task 2.2.2: Remote TUI mode

`kitnclaw connect ws://gateway:18800` — connect a TUI instance to a remote gateway. The gateway exposes a WebSocket endpoint for authenticated TUI connections. Uses token-based auth from config.

---

## Phase 3: Web UI Channel

### Task 2.3.1: Web channel adapter

Create a web-based channel using the gateway's HTTP server:
- `GET /` serves a minimal chat web app (could be Solid.js or vanilla)
- `POST /api/message` sends messages to the session manager
- `GET /api/stream` SSE endpoint for agent responses
- Authentication via token in config

### Task 2.3.2: Web UI implementation

Build a minimal but functional web chat interface:
- Markdown rendering
- Tool call visualization
- Permission prompts (approve/deny buttons)
- Session management
- Mobile-responsive (works on phones via Tailscale)

---

## Phase 4: Multi-User Access Control

### Task 2.4.1: User/role system

Extend config with user definitions:
```json
{
  "users": {
    "admin": { "role": "operator", "channels": ["*"] },
    "friend": { "role": "guest", "channels": ["telegram"], "tools": { "denied": ["bash", "file-write"] } }
  }
}
```

Roles: `operator` (full access), `user` (standard access), `guest` (read + safe tools only).

### Task 2.4.2: Channel-level pairing

Like OpenClaw's pairing system — unknown users on messaging platforms must be approved before they can interact. Pairing codes with expiry.

---

## Phase 5: Proactive Actions

### Task 2.5.1: HEARTBEAT.md — periodic checklists

A `~/.kitnclaw/workspace/HEARTBEAT.md` file that defines periodic tasks:
```markdown
## Every Morning (9:00 AM)
- Check email for urgent messages
- Summarize calendar for the day
- Check stock portfolio

## Every Hour
- Check Discord mentions
```

The gateway's cron system executes these on schedule.

### Task 2.5.2: Cron integration

Wire @kitnai/core's existing `CronScheduler` and `InternalScheduler` into KitnClaw. Allow the agent to create, modify, and delete scheduled tasks. Heartbeat entries translate to cron jobs.

---

# Epic 3 (V3): Ecosystem + Advanced Features

Growing the platform. Community, marketplace, advanced AI capabilities.

---

## Phase 1: Voice Integration

### Task 3.1.1: Voice input/output

Integrate @kitnai/core's voice capabilities (if available) or build:
- **Speech-to-text**: Whisper API or local Whisper via Ollama
- **Text-to-speech**: OpenAI TTS, ElevenLabs, or local Piper
- Terminal: microphone input via system audio APIs
- Messaging: Voice messages on Telegram/WhatsApp auto-transcribed

### Task 3.1.2: Voice channel (optional)

A dedicated voice channel — real-time conversation via WebRTC or similar. Think "Hey Siri" but it's KitnClaw.

---

## Phase 2: Global Registry for Community Contributions

### Task 3.2.1: Channel component type

Add `kitn:channel` as a new component type in cli-core. Channels are installable via `kitn add discord-channel`. Update the registry build pipeline.

### Task 3.2.2: Community skill registry

Allow users to publish skills (Markdown files) to a registry. Skills are searchable by the agent. Include a trust/verification system to prevent the malicious skill problem that plagues OpenClaw's ClawHub (36% contain prompt injection).

### Task 3.2.3: Skill verification pipeline

Automated scanning of community skills for:
- Prompt injection patterns
- External URL fetching
- Data exfiltration attempts
- Excessive permission requests

Skills get a trust score. Unverified skills require explicit user approval.

---

## Phase 3: Mobile Access

### Task 3.3.1: Progressive Web App

Turn the web UI (from Epic 2 Phase 3) into a PWA:
- Installable on iOS/Android
- Push notifications for async agent responses
- Offline queue (messages saved locally, sent when reconnected)
- Works over Tailscale

### Task 3.3.2: Native mobile app (stretch goal)

React Native or Expo app for a more polished mobile experience. Connects to the gateway via Tailscale. Includes voice input.

---

## Phase 4: Advanced Memory

### Task 3.4.1: RAG pipeline

Retrieval-Augmented Generation:
- Users can add documents (PDFs, markdown, web pages) to a knowledge base
- Documents chunked, embedded, stored in libSQL
- Agent queries knowledge base automatically when relevant
- `/knowledge add <url>` and `/knowledge add <file>` commands

### Task 3.4.2: Knowledge graphs

Build a lightweight knowledge graph alongside vector memory:
- Entities and relationships extracted from conversations
- Graph queries for "what do I know about X?"
- Temporal awareness (when was this learned?)

### Task 3.4.3: Context compaction

Implement robust context compaction (a major OpenClaw pain point):
- When conversation exceeds token limit, summarize older messages
- Preserve key facts in memory before discarding
- Never lose tool results or important decisions
- Use @kitnai/core's existing `compactConversation()` as the foundation

---

## Phase 5: Marketplace + Billing (Stretch)

### Task 3.5.1: KitnClaw Hub

A web platform for sharing:
- Skills (verified, with trust scores)
- Channel adapters
- Tool packs
- Agent templates
- Themes (TUI color schemes)

### Task 3.5.2: Hosted KitnClaw

For non-technical users: a hosted version of KitnClaw that doesn't require running a local gateway. Uses Turso for cloud libSQL, server-side agent execution, web UI.

### Task 3.5.3: Billing integration

For the hosted version:
- Token usage tracking
- Free tier (limited messages/month)
- Paid plans (unlimited, priority models)
- BYOK (Bring Your Own Key) option

---

# Implementation Order Summary

| Epic | Phase | Description | Priority |
|------|-------|-------------|----------|
| 1 | 1 | Package scaffolding + gateway core | **Now** |
| 1 | 2 | Built-in tools + permissions | **Now** |
| 1 | 3 | Session persistence + libSQL memory | **Now** |
| 1 | 4 | Terminal UI (OpenTUI) | **Now** |
| 1 | 5 | Channel abstraction + Discord/Telegram/WhatsApp | **Now** |
| 1 | 6 | Hot-reload + dynamic creation | **Now** |
| 1 | 7 | Deprecate chat-service | **Now** |
| 1 | 8 | Agent loop + system prompt + integration | **Now** |
| 2 | 1 | Sandboxing | After V1 |
| 2 | 2 | Remote access (Tailscale/Headscale) | After V1 |
| 2 | 3 | Web UI channel | After V1 |
| 2 | 4 | Multi-user access control | After V1 |
| 2 | 5 | Proactive actions (HEARTBEAT.md + cron) | After V1 |
| 3 | 1 | Voice integration | After V2 |
| 3 | 2 | Global registry + community skills | After V2 |
| 3 | 3 | Mobile access (PWA + native) | After V2 |
| 3 | 4 | Advanced memory (RAG + knowledge graphs) | After V2 |
| 3 | 5 | Marketplace + billing (stretch) | After V2 |
