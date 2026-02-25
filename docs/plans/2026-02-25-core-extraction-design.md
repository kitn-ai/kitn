# Design: @kitnai/core Extraction and Platform Evolution

## Context

The `@kitnai/server` package bundles two distinct concerns:

1. **Engine** — agent orchestration, tool management, storage, memory, conversations, events, voice, resilience, compaction. Zero Hono dependency.
2. **HTTP layer** — Hono routes, OpenAPI registration, Scalar docs, SSE streaming via Hono, auth middleware.

Users who want a different framework (Express, Elysia, Cloudflare Workers) cannot use the engine without pulling in Hono. The source-installable story (`kitn add`) also needs clean package boundaries.

## Decision Summary

| Decision | Choice |
|----------|--------|
| AI SDK coupling | Peer dependency of core (not abstracted) |
| SSE streaming | Web-standard Response + ReadableStream |
| Handler signatures | `AgentRequest` interface (not Hono Context) |
| Orchestrator location | Core (returns web-standard Responses) |
| API schemas location | Core (Zod + .openapi() metadata, portable) |
| Package naming | `@kitnai/core` (engine) + `@kitnai/hono` (adapter) |
| Install directory | Default `src/ai/`, configurable via `kitn.json` |
| Extraction approach | Restructure into domain modules (Approach B) |
| Implementation scope | Design all layers, implement Layer A first |

## Layer A: Core Extraction (implement now)

### Package: `@kitnai/core`

Framework-agnostic engine. Peer deps: `ai`, `zod`. No Hono.

```
packages/core/
  package.json
  tsconfig.json
  src/
    index.ts                          # barrel exports

    types.ts                          # AgentRequest, core config types

    agents/
      orchestrator.ts                 # createOrchestratorAgent
      execute-task.ts                 # executeTask
      run-agent.ts                    # runAgent
      memory-tool.ts                  # createMemoryTool

    registry/
      agent-registry.ts              # AgentRegistry (uses AgentRequest)
      tool-registry.ts               # ToolRegistry
      handler-factories.ts           # makeRegistryHandlers

    storage/
      interfaces.ts                  # all storage interfaces
      skill-helpers.ts               # parseFrontmatter, buildSkill
      file-storage/                  # 6 file-based stores + index
      in-memory/                     # in-memory stores + index

    streaming/
      stream-helpers.ts              # streamAgentResponse (web-standard)
      sse-writer.ts                  # SSE formatting over ReadableStream

    events/
      agent-events.ts                # AgentEventBus
      events.ts                      # SSE_EVENTS, BUS_EVENTS, STATUS_CODES
      emit-status.ts                 # emitStatus, writeStatus

    voice/
      voice-provider.ts              # interfaces
      voice-manager.ts               # VoiceManager
      openai-voice-provider.ts       # OpenAIVoiceProvider

    utils/
      ai-provider.ts                 # extractUsage, mergeUsage
      card-registry.ts               # CardRegistry
      constants.ts                   # TOOL_NAMES, DEFAULTS
      delegation-context.ts          # AsyncLocalStorage delegation
      request-registry.ts            # AbortController registry
      resilience.ts                  # withResilience
      compaction.ts                  # compactConversation
      conversation-helpers.ts        # loadConversationWithCompaction
      tool-examples.ts               # formatExamplesBlock

    schemas/
      generate.schemas.ts            # Zod schemas with .openapi() metadata
      agents.schemas.ts
      memory.schemas.ts
      skills.schemas.ts
      voice.schemas.ts
```

### Key Abstractions

**`AgentRequest`** — replaces Hono's `Context` in all core handler signatures:

```ts
interface AgentRequest {
  json<T = unknown>(): Promise<T>;
  query(key: string): string | undefined;
  param(key: string): string;
  header(key: string): string | undefined;
  signal: AbortSignal;
}
```

**`createSSEStream`** — replaces Hono's `streamSSE`:

```ts
interface SSEWriter {
  writeSSE(event: { event: string; data: string; id?: string }): void;
}

function createSSEStream(
  handler: (writer: SSEWriter) => Promise<void>,
  signal?: AbortSignal,
): Response
```

Returns a web-standard `Response` with `Content-Type: text/event-stream` and a `ReadableStream` body. Works on any runtime that supports the Fetch API Response.

### Package: `@kitnai/hono` (renamed from `@kitnai/server`)

Thin Hono adapter. Deps: `@kitnai/core`, `hono`, `@hono/zod-openapi`, `@scalar/hono-api-reference`.

```
packages/hono/                        # renamed from packages/server/
  src/
    index.ts                          # re-exports from @kitnai/core + own exports
    plugin.ts                         # createAIPlugin (builds OpenAPIHono)
    types.ts                          # AIPluginConfig, AIPluginInstance

    middleware/
      auth.ts                         # createApiKeyAuth

    openapi/
      configure-openapi.ts            # Scalar UI + /doc endpoint

    adapters/
      request-adapter.ts              # Hono Context → AgentRequest
      stream-adapter.ts               # core Response → Hono response

    routes/
      health/health.route.ts
      agents/agents.routes.ts
      tools/tools.routes.ts
      generate/generate.routes.ts
      generate/generate.handlers.ts
      memory/memory.routes.ts
      memory/memory.handlers.ts
      skills/skills.routes.ts
      skills/skills.handlers.ts
      conversations/conversations.routes.ts
      voice/voice.routes.ts
```

Route handlers become thin adapters:

```ts
// Before (Hono coupled):
const handler = (c: Context) => {
  const body = await c.req.json();
  return streamSSE(c, async (stream) => { ... });
};

// After (adapter pattern):
const handler = (c: Context) => {
  const req = toAgentRequest(c);
  return coreStreamHandler(req);  // returns web-standard Response
};
```

### What Moves Where

| Current location | Moves to | Notes |
|-----------------|----------|-------|
| `server/src/lib/agent-events.ts` | `core/src/events/agent-events.ts` | No changes |
| `server/src/lib/events.ts` | `core/src/events/events.ts` | No changes |
| `server/src/lib/emit-status.ts` | `core/src/events/emit-status.ts` | No changes |
| `server/src/lib/stream-helpers.ts` | `core/src/streaming/stream-helpers.ts` | Replace `streamSSE` with `createSSEStream` |
| *(new)* | `core/src/streaming/sse-writer.ts` | Web-standard SSE writer |
| `server/src/lib/run-agent.ts` | `core/src/agents/run-agent.ts` | No changes |
| `server/src/agents/orchestrator.ts` | `core/src/agents/orchestrator.ts` | Replace `streamSSE`/`Context` with `createSSEStream`/`AgentRequest` |
| `server/src/agents/execute-task.ts` | `core/src/agents/execute-task.ts` | No changes |
| `server/src/agents/memory-tool.ts` | `core/src/agents/memory-tool.ts` | No changes |
| `server/src/registry/agent-registry.ts` | `core/src/registry/agent-registry.ts` | `AgentHandler` uses `AgentRequest` |
| `server/src/registry/tool-registry.ts` | `core/src/registry/tool-registry.ts` | No changes |
| `server/src/registry/handler-factories.ts` | `core/src/registry/handler-factories.ts` | Uses `AgentRequest` |
| `server/src/storage/*` | `core/src/storage/*` | No changes |
| `server/src/voice/*` | `core/src/voice/*` | No changes |
| `server/src/lib/ai-provider.ts` | `core/src/utils/ai-provider.ts` | No changes |
| `server/src/lib/card-registry.ts` | `core/src/utils/card-registry.ts` | No changes |
| `server/src/lib/constants.ts` | `core/src/utils/constants.ts` | No changes |
| `server/src/lib/delegation-context.ts` | `core/src/utils/delegation-context.ts` | No changes |
| `server/src/lib/request-registry.ts` | `core/src/utils/request-registry.ts` | No changes |
| `server/src/lib/resilience.ts` | `core/src/utils/resilience.ts` | No changes |
| `server/src/lib/compaction.ts` | `core/src/utils/compaction.ts` | No changes |
| `server/src/lib/conversation-helpers.ts` | `core/src/utils/conversation-helpers.ts` | No changes |
| `server/src/lib/tool-examples.ts` | `core/src/utils/tool-examples.ts` | No changes |
| `server/src/routes/generate/generate.schemas.ts` | `core/src/schemas/generate.schemas.ts` | No changes (pure Zod) |
| `server/src/routes/agents/agents.schemas.ts` | `core/src/schemas/agents.schemas.ts` | No changes |
| `server/src/routes/memory/memory.schemas.ts` | `core/src/schemas/memory.schemas.ts` | No changes |
| `server/src/routes/skills/skills.schemas.ts` | `core/src/schemas/skills.schemas.ts` | No changes |
| `server/src/routes/voice/voice.schemas.ts` | `core/src/schemas/voice.schemas.ts` | No changes |
| `server/src/context.ts` | `core/src/types.ts` (merged) | PluginContext becomes part of core types |
| `server/src/types.ts` | Split: core types → `core/src/types.ts`, Hono types → `hono/src/types.ts` | |
| `server/src/plugin.ts` | `hono/src/plugin.ts` | Stays in Hono adapter |
| `server/src/lib/auth.ts` | `hono/src/middleware/auth.ts` | Stays in Hono adapter |
| `server/src/lib/configure-openapi.ts` | `hono/src/openapi/configure-openapi.ts` | Stays in Hono adapter |
| `server/src/routes/*` | `hono/src/routes/*` | Route files stay in Hono adapter |

### Files That Need Modification (not just a move)

1. **`agent-registry.ts`** — `AgentHandler` type: `(c: Context)` → `(req: AgentRequest)`
2. **`handler-factories.ts`** — `c.req.json()` → `req.json()`, `c.json()` → `new Response(JSON.stringify(...))`
3. **`orchestrator.ts`** — replace `streamSSE(c, ...)` with `createSSEStream(...)`, `c.req.json()` → `req.json()`
4. **`stream-helpers.ts`** — replace `streamSSE` with `createSSEStream`, `Context` → `AgentRequest`
5. **`types.ts`** — split into core types (no Hono) and Hono types (with `OpenAPIHono`, `MiddlewareHandler`)

### Existing Tests

All 183 tests currently live in `packages/server/test/`. Tests for core functionality (orchestrator, storage, events, etc.) move to `packages/core/test/`. Tests for route handlers stay in `packages/hono/test/`.

---

## Layer B: Source-Installable Packages with Wizard (design only)

### Enhanced `kitn init`

```
Welcome to kitn!

Package manager?          [npm / pnpm / bun]
Runtime?                  [node / bun / deno]
Component directory?      [src/ (default)]
Package install directory? [src/ai (default)]
```

Writes `kitn.json`:
```json
{
  "runtime": "node",
  "aliases": {
    "agents": "src/agents",
    "tools": "src/tools",
    "skills": "src/skills",
    "storage": "src/storage",
    "packages": "src/ai"
  },
  "registries": { "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json" }
}
```

### `kitn add core`

Installs `@kitnai/core` source into `src/ai/core/`:
- Copies all core source files preserving directory structure
- Patches `tsconfig.json` with `"@kitnai/core": ["./src/ai/core/index.ts"]`
- Installs peer deps: `ai`, `zod`
- Records in `_installed` with full file list and hash

### `kitn add hono` (interactive wizard)

```
Installing @kitnai/hono...

Include OpenAPI route registration?  [Yes / No]
Include Scalar API reference UI?     [Yes / No]
Install @kitnai/core as:             [npm package / source]

Installing to: src/ai/hono/
```

Based on selections:
- **No OpenAPI**: Routes use plain `Hono` instead of `OpenAPIHono`. Schema files excluded.
- **No Scalar**: `configure-openapi.ts` omits Scalar handler. `@scalar/hono-api-reference` not installed.
- **Core as npm**: `npm install @kitnai/core`. Core stays in node_modules.
- **Core as source**: Runs `kitn add core` first, then installs hono source.

### Registry Format for Packages

New component type `kitn:package` with nested file paths:

```json
{
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine",
  "dependencies": [],
  "peerDependencies": ["ai", "zod"],
  "files": [
    { "path": "core/index.ts", "content": "..." },
    { "path": "core/types.ts", "content": "..." },
    { "path": "core/agents/orchestrator.ts", "content": "..." }
  ],
  "tsconfig": {
    "@kitnai/core": ["./index.ts"]
  }
}
```

The `tsconfig` field tells the CLI what paths mapping to add.

---

## Layer C: CLI Platform Features (design only)

### `kitn list` — Browse registry

```bash
kitn list                    # all components
kitn list agents             # filter by type
kitn list --search weather   # search by name/description
```

Fetches `registry.json` and displays a formatted table.

### `kitn update` — Check for updates

```bash
kitn update                  # check all installed components
kitn update weather-tool     # check specific component
```

Compares `_installed[name].version` against registry. Shows available updates with changelogs. Interactive selection of which updates to apply.

### `kitn status` — Installation overview

```bash
kitn status
```

Shows installed components, versions, modification status (local changes detected via hash comparison), and packages (source vs npm).

### Registry Versioning

Each component's `manifest.json` includes `version`. The build script includes version in the registry JSON. The registry can host multiple versions:
- `r/agents/weather-agent.json` — latest
- `r/agents/weather-agent@1.0.0.json` — pinned version

The CLI defaults to latest but supports `kitn add weather-agent@1.0.0`.

---

## Implementation Order

1. **Layer A** — Extract `@kitnai/core`, rename `@kitnai/server` → `@kitnai/hono`, update all imports. All tests pass.
2. **Layer B** — Extend registry schema for `kitn:package`, implement `kitn add core`/`kitn add hono` with wizard, tsconfig patching.
3. **Layer C** — Implement `kitn list`, `kitn update`, `kitn status`, registry versioning.

Each layer is independently shippable and builds on the previous.
