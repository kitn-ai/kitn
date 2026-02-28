# kitn

TypeScript monorepo for multi-agent AI systems. Bun workspaces, 5 packages, 4 examples.

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
  client/     @kitnai/client — browser utilities (SSE parsing, audio recording, TTS playback)
  cli/        @kitnai/cli    — CLI for the component registry (add, list, diff, update)
examples/
  api/            REST API server
  app/            Solid.js frontend
  voice/          Voice client
  getting-started/ Minimal getting-started example
```

> **Note:** The `@kitnai/*` names above are internal workspace package names. User projects import from the published npm scope: `@kitn/core` (maps to `@kitnai/core`) and `@kitn/adapters/hono` (maps to `@kitnai/hono-adapter`).

**Dependency graph:** adapters depend on `core`. `cli` and `client` are standalone.

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

Commands use commander + @clack/prompts + picocolors:

1. Export `async function xxxCommand(args, opts)` from `packages/cli/src/commands/<name>.ts`
2. Use `@clack/prompts` for UI (`p.intro`, `p.log`, `p.spinner`, `p.outro`)
3. Use `picocolors` for formatting
4. Read config with `readConfig(cwd)`
5. Register in `packages/cli/src/index.ts` with dynamic import:
   ```ts
   program.command("<name>").description("...").action(async (...) => {
     const { xxxCommand } = await import("./commands/<name>.js");
     await xxxCommand(args, opts);
   });
   ```

Reference: `packages/cli/src/commands/list.ts` (simple), `packages/cli/src/commands/add.ts` (complex)

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
