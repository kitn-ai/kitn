# kitn

TypeScript monorepo for multi-agent AI systems. Bun workspaces, 8 packages, 4 examples.

## Commands

```bash
bun install                          # install all dependencies
bun run build                        # build all packages
bun run test                         # test all packages
bun run typecheck                    # typecheck all packages
bun run dev                          # run all examples concurrently
bun run dev:api                      # API server on :4000
bun run dev:app                      # Solid.js frontend on :5173
bun run dev:voice                    # voice client on :5174
bun run dev:mcp                      # MCP server (builds deps first)
bun run dev:cli                      # CLI (builds deps first)

# Targeted builds (respects dependency order)
bun run build:mcp                    # cli-core + mcp-server
bun run build:cli                    # cli-core + cli
bun run build:core                   # cli-core only

# Targeted tests
bun run test:core                    # @kitnai/core
bun run test:cli                     # @kitnai/cli
bun run test:cli-core                # @kitnai/cli-core

# Per-package
bun run --cwd packages/core test
bun run --cwd packages/adapters/hono build
bun test path/to/test.ts             # single test file
```

## Monorepo Structure

```
packages/
  core/       @kitnai/core             — framework-agnostic engine (agents, tools, storage, memory, voice)
  adapters/
    hono/           @kitnai/hono-adapter         — plain Hono adapter (routes, plugin factory)
    hono-openapi/   @kitnai/hono-openapi-adapter — OpenAPI Hono adapter (zod-openapi routes, /doc spec)
    elysia/         @kitnai/elysia-adapter       — Elysia adapter
  client/     @kitnai/client     — browser utilities (SSE parsing, audio recording, TTS playback)
  cli-core/   @kitnai/cli-core   — pure logic shared by CLI + MCP server (no UI, no protocol)
  cli/        @kitnai/cli        — CLI for the component registry (add, list, diff, update)
  mcp-server/ @kitnai/mcp-server — MCP server for AI coding assistants (16 tools, 2 resources)
examples/
  api/            REST API server
  app/            Solid.js frontend
  voice/          Voice client
  getting-started/ Minimal getting-started example
```

> **Note:** The `@kitnai/*` names above are internal workspace package names. User projects import from the published npm scope: `@kitn/core` (maps to `@kitnai/core`) and `@kitn/adapters/hono` (maps to `@kitnai/hono-adapter`).

**Dependency graph:** adapters depend on `core`. `cli` and `mcp-server` depend on `cli-core`. `client` is standalone.

## Architecture

- **`@kitnai/core`** is framework-agnostic — no HTTP types, pure TypeScript
- **`@kitnai/hono-adapter`** is a thin adapter that mounts routes onto a Hono app
- **`PluginContext`** is the central context object passed to all route factories. It holds registries (agents, tools, cards), storage, voice manager, model getter, and config.
- **`StorageProvider`** aggregates 7 sub-stores: `conversations`, `memory`, `skills`, `tasks`, `prompts`, `audio`, `commands`
- Implementations: `createFileStorage()` for file-based JSON, `createMemoryStorage()` for in-memory

## Import Conventions

These conventions apply **within the monorepo** (for developers working on kitn itself):

- Always use `.js` extension in relative imports (TypeScript compiles to JS)
- Use `@kitnai/core` and `@kitnai/hono-adapter` for cross-package imports within the monorepo
- Use `ai` package for Vercel AI SDK types and functions (e.g. `tool()`, `streamText()`)

User projects import from the published npm packages: `@kitn/core` and `@kitn/adapters/hono`.

## Hono Route Pattern

Routes follow a `createXxxRoutes(ctx)` factory pattern split across two files:

1. **`<domain>.routes.ts`** — `createXxxRoutes(ctx: PluginContext)` returns a Hono router with route definitions + zod schemas
2. **`<domain>.handlers.ts`** — `createXxxHandlers(ctx: PluginContext)` returns named handler functions
3. **Mount in `packages/adapters/hono/src/plugin.ts`**: `app.route("/<domain>", createXxxRoutes(ctx))`

Reference: `packages/adapters/hono/src/routes/memory/` (memory.routes.ts + memory.handlers.ts)

## CLI Command Pattern

Commands are split into two layers:

- **`cli-core`** — pure logic: takes all inputs upfront, returns structured results, throws typed errors. No UI, no `process.exit`, no `@clack/prompts`.
- **`cli`** — thin UI wrapper: prompts for missing inputs, calls cli-core, formats output with `@clack/prompts` + `picocolors`.

1. Core logic in `packages/cli-core/src/commands/<name>.ts` — export `async function xxxAction(opts): Promise<Result>`
2. CLI wrapper in `packages/cli/src/commands/<name>.ts` — export `async function xxxCommand(args, opts)`
3. Register in `packages/cli/src/index.ts` with dynamic import

Reference: `packages/cli-core/src/commands/list.ts` (core) + `packages/cli/src/commands/list.ts` (wrapper)

## MCP Server Tool Pattern

Tools follow a register function pattern:

1. Export `registerXxxTool(server: McpServer)` from `packages/mcp-server/src/tools/<name>.ts`
2. Use Zod schemas with `.describe()` for input parameters
3. Import core logic from `@kitnai/cli-core`
4. Return `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`
5. Wrap in try/catch, return `{ isError: true }` on failure
6. Register in `packages/mcp-server/src/server.ts`

Reference: `packages/mcp-server/src/tools/project.ts` (simple), `packages/mcp-server/src/tools/add.ts` (complex)

## Testing

- Framework: `bun:test` (`describe`, `test`, `expect`)
- Test files: `test/` directories or co-located `*.test.ts`
- Run single: `bun test path/to/test.ts`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR workflow, and how to create registry components.

## Key Types

- `PluginContext` — central context (registries, storage, model getter)
- `AIPluginConfig` — plugin configuration (model, storage, voice, etc.)
- `StorageProvider` — aggregates 6 sub-stores (see `packages/core/src/storage/interfaces.ts`)
- `AgentRegistration` / `ToolRegistration` — registered agent/tool definitions

## Lockfile

CI uses `bun install --frozen-lockfile`, which fails if `bun.lock` is stale. A pre-commit hook in `.hooks/` auto-runs `bun install` and stages `bun.lock` whenever a `package.json` is committed. On a fresh clone, enable the hooks:

```bash
git config core.hooksPath .hooks
```

## Recommended MCP Plugins

- **Context7** — use for up-to-date Vercel AI SDK, Hono, and Zod documentation
