# Design: Self-Registration, Commands, and Scoped Storage

## Context

When a user runs `kitn add weather-agent`, the CLI copies the component file into `src/ai/agents/` but doesn't wire it into the application. The user must manually import it, create handlers, and register it with the plugin. This friction undermines the "just add and go" experience.

Additionally, the framework lacks two capabilities that users need: commands (saved prompt + tool templates) and multi-tenant scoping on storage operations.

## Decision Summary

| Decision | Choice |
|----------|--------|
| Registration API | Per-type functions: `registerAgent()`, `registerTool()`, `registerCommand()`, `registerSkill()` |
| Registry utility location | Ships in `@kitnai/core` |
| Barrel file | `src/ai/index.ts`, created at `kitn add core` time, auto-managed by CLI |
| User-created components | Live outside `src/ai/`, register from anywhere via same functions |
| CLI auto-wiring | `kitn add` appends imports to barrel; `kitn remove` removes them |
| Commands | New component type: saved prompt template + tool selection |
| Scoping | Optional `scopeId` on conversations, memory, commands, audio stores |
| Model config rename | `getModel(id)` → `model(model)` across codebase |
| Registry schema | No changes needed — component type field is sufficient |
| kitn.json files list | Kept as-is |

---

## 1. Self-Registration API

### New module: `packages/core/src/registry/self-register.ts`

Per-type registration functions collect configs into typed Maps at module load time. A flush function pushes everything into the plugin after creation.

```ts
// Registration functions — called at module level by component files
registerAgent(config: AgentSelfRegConfig): void
registerTool(config: ToolSelfRegConfig): void
registerCommand(config: CommandSelfRegConfig): void
registerSkill(config: SkillSelfRegConfig): void

// Flush function — called once after plugin creation
registerWithPlugin(ctx: PluginContext): void
```

### Type definitions

```ts
interface AgentSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools: Record<string, any>;
  format?: "json" | "sse";
}

interface ToolSelfRegConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
}

interface CommandSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools?: string[];       // tool names resolved from ToolRegistry at flush time
  model?: string;
  format?: "json" | "sse";
}

interface SkillSelfRegConfig {
  name: string;
  description: string;
  // future: additional skill-specific fields
}
```

### Internal mechanics

Each register function stores into a module-scoped Map:

```ts
const agentConfigs = new Map<string, AgentSelfRegConfig>();
const toolConfigs = new Map<string, ToolSelfRegConfig>();
const commandConfigs = new Map<string, CommandSelfRegConfig>();
const skillConfigs = new Map<string, SkillSelfRegConfig>();
```

`registerWithPlugin(ctx)`:
1. Iterates `toolConfigs`, calls `ctx.tools.register()` for each
2. Iterates `agentConfigs`, creates handlers via `makeRegistryHandlers()`, calls `ctx.agents.register()` for each
3. Iterates `commandConfigs`, saves to `ctx.storage.commands` (new store)
4. Iterates `skillConfigs`, registers with skill store

### Exports

Added to `packages/core/src/index.ts`:

```ts
export {
  registerAgent,
  registerTool,
  registerCommand,
  registerSkill,
  registerWithPlugin,
} from "./registry/self-register.js";
```

### Body-passing fix

Already applied to source files. Ships with the updated core:
- `agent-registry.ts`: `AgentHandler` options include `body?: Record<string, any>`
- `handler-factories.ts`: Handlers use `preParsedBody ?? await req.json()`
- `agents.routes.ts`: Parses body once, passes to handler

---

## 2. Commands

A command is a saved prompt template with optional tool selection. Simpler than an agent — no dedicated handler, just a config that creates an ad-hoc agent run when invoked.

### Data model

```ts
interface CommandRegistration {
  name: string;
  description: string;
  system: string;         // system prompt template
  tools?: string[];       // tool names resolved from ToolRegistry
  model?: string;         // optional model override
  format?: "json" | "sse";
}
```

### Storage: `CommandStore`

New sub-store added to `StorageProvider`:

```ts
interface CommandStore {
  list(scopeId?: string): Promise<CommandRegistration[]>;
  get(name: string, scopeId?: string): Promise<CommandRegistration | undefined>;
  save(command: CommandRegistration, scopeId?: string): Promise<void>;
  delete(name: string, scopeId?: string): Promise<void>;
}
```

Implementations: file-based (`storage/file-storage/command-store.ts`) and in-memory (`storage/in-memory/command-store.ts`).

### Routes: `/api/commands`

New route file: `packages/hono/src/routes/commands/commands.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/commands` | List all commands |
| `GET` | `/commands/:name` | Get command details |
| `POST` | `/commands` | Create or update a command |
| `DELETE` | `/commands/:name` | Delete a command |
| `POST` | `/commands/:name/run` | Execute command as ad-hoc agent |

### Execution flow for `/commands/:name/run`

1. Look up command config from `CommandStore`
2. Resolve tool names to tool instances from `ToolRegistry`
3. Build agent config: `{ system: command.system, tools: resolvedTools }`
4. Delegate to `runAgent()` (JSON) or `streamAgentResponse()` (SSE) based on command format or query param

### Self-registration

Components can ship built-in commands via `registerCommand()`. Users can also create commands at runtime via the REST API.

---

## 3. scopeId on Storage

An optional `scopeId` parameter threaded through storage interfaces. The framework does not manage users or auth. The application passes in whatever external identifier makes sense for its context (user ID, team ID, API key, etc.).

### Scoped stores

| Store | Scoped | Rationale |
|-------|--------|-----------|
| Conversations | Yes | Different users have different chat histories |
| Memory | Yes | Per-user memory contexts |
| Commands | Yes | Users can create personal commands |
| Audio | Yes | Voice recordings are per-user |
| Skills | No | Static configuration, shared |
| Prompts | No | Global admin configuration |

### Interface changes

Optional `scopeId` added as last parameter on read/write methods:

```ts
// ConversationStore
list(scopeId?: string): Promise<ConversationMeta[]>
append(convId: string, msg: Message, scopeId?: string): Promise<void>
load(convId: string, scopeId?: string): Promise<Message[]>

// MemoryStore
loadMemories(namespace: string, scopeId?: string): Promise<Memory[]>
saveMemory(namespace: string, key: string, value: string, scopeId?: string): Promise<void>
deleteMemory(namespace: string, key: string, scopeId?: string): Promise<void>

// CommandStore (new, scoped from the start)
list(scopeId?: string): Promise<CommandRegistration[]>
get(name: string, scopeId?: string): Promise<CommandRegistration | undefined>
save(command: CommandRegistration, scopeId?: string): Promise<void>
delete(name: string, scopeId?: string): Promise<void>

// AudioStore
save(id: string, data: Buffer, scopeId?: string): Promise<void>
load(id: string, scopeId?: string): Promise<Buffer | null>
```

### Storage implementation

**File-based:** scopeId becomes a subdirectory.
- Without scope: `data/conversations/conv_123.json`
- With scope: `data/conversations/{scopeId}/conv_123.json`

**In-memory:** scopeId prefixes the key.
- Without scope: key = `conv_123`
- With scope: key = `{scopeId}:conv_123`

When scopeId is omitted, methods return all entries (backwards compatible).

### Route-level threading

Routes accept scopeId via request header (`X-Scope-Id`). The application's middleware can set this header however it wants (from JWT, API key, etc.). Hono routes extract it and pass through to storage calls.

---

## 4. CLI Auto-Wiring

### `src/ai/` as a managed closed box

The `src/ai/` directory is kitn-managed. Users can read and modify files, but the CLI owns the structure. User-created components live outside this directory.

### Barrel file lifecycle

**Created at `kitn add core` time:**

```ts
export { registerWithPlugin } from "@kitnai/core";
```

**After `kitn add weather-agent` and `kitn add weather-tool`:**

```ts
import "./agents/weather-agent.ts";
import "./tools/weather.ts";
export { registerWithPlugin } from "@kitnai/core";
```

**After `kitn remove weather-tool`:**

```ts
import "./agents/weather-agent.ts";
export { registerWithPlugin } from "@kitnai/core";
```

### CLI behavior on `kitn add`

For `kitn:agent`, `kitn:tool`, `kitn:command`, and `kitn:skill` types:
1. Write component file to `src/ai/{type}/{name}.ts`
2. Parse barrel file (`src/ai/index.ts`)
3. Check if import line already exists (idempotent)
4. Insert import line before the `export` line
5. Write updated barrel

### CLI behavior on `kitn remove`

1. Delete component file from `src/ai/{type}/{name}.ts`
2. Parse barrel file
3. Remove the matching import line
4. Write updated barrel

### One-time setup hint

Printed on first component install (when barrel file is created):

```
Created src/ai/index.ts

Add this to your app setup:

  import { createAIPlugin } from "@kitnai/hono";
  import { registerWithPlugin } from "./ai";

  const plugin = createAIPlugin({
    model: (model) => yourProvider(model ?? "default-model"),
  });

  registerWithPlugin(plugin);
  app.route("/api", plugin.app);

See https://kitn.dev/docs/setup for provider examples.
```

### User-created components

Users register their own components from anywhere using the same functions:

```ts
// src/my-agents/custom-agent.ts (user's own file, outside src/ai/)
import { registerAgent } from "@kitnai/core";

registerAgent({
  name: "my-agent",
  description: "My custom agent",
  system: "You are...",
  tools: { myTool },
});
```

The register functions collect into the same Maps regardless of call site. `registerWithPlugin()` flushes everything — kitn-managed and user-created.

---

## 5. Model Config Rename

Rename `getModel` → `model` across the codebase. The parameter inside the function is also renamed from `id` to `model`.

**Before:**
```ts
const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? "openai/gpt-4o-mini"),
});
// Internal: ctx.getModel(modelId)
```

**After:**
```ts
const plugin = createAIPlugin({
  model: (model) => openrouter(model ?? "openai/gpt-4o-mini"),
});
// Internal: ctx.model(modelName)
```

### Files affected

- `packages/core/src/types.ts` — `PluginContext.getModel` → `PluginContext.model`
- `packages/hono/src/types.ts` — `AIPluginConfig.getModel` → `AIPluginConfig.model`
- `packages/hono/src/plugin.ts` — config destructuring and context creation
- All call sites in core that reference `ctx.getModel()` → `ctx.model()`
- Examples and documentation

---

## 6. Registry Components

No schema changes needed. The component type field (`kitn:agent`, `kitn:tool`, etc.) tells the CLI which components get barrel imports.

Registry-published component templates include the self-registration call baked into the source. For example, a weather agent template ends with:

```ts
import { registerAgent } from "@kitnai/core";

registerAgent({
  name: "weather",
  description: "Weather specialist",
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
});
```

The CLI does not inject registration code. Its only job is managing barrel imports.

---

## Implementation Phases

| Phase | Scope | Packages | Dependencies |
|-------|-------|----------|--------------|
| 1 | Self-registration API + body fix + `model` rename | `core`, `hono` | None |
| 2 | Commands (type, store, routes, self-reg) | `core`, `hono` | Phase 1 |
| 3 | scopeId on storage interfaces + implementations | `core`, `hono` | Phase 1 |
| 4 | CLI auto-wiring (barrel management, hints) | `cli` | Phase 1 |
| 5 | Registry component templates (add self-reg calls) | registry | Phase 1, 4 |

Phases 2, 3, and 4 are independent of each other and can be done in parallel after Phase 1.

---

## What Does NOT Change

- **kitn.json files list** — kept as-is, still used by diff/remove/update
- **Registry schema** — no new fields
- **`kitn diff` / `kitn update`** — work unchanged
- **Existing storage interfaces** — scopeId is additive (optional parameter)
