# kitn

TypeScript monorepo for multi-agent AI systems. Bun workspaces, 4 packages, 4 examples.

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
bun run --cwd packages/hono build
bun test path/to/test.ts             # single test file
```

## Monorepo Structure

```
packages/
  core/       @kitnai/core   — framework-agnostic engine (agents, tools, storage, memory, voice)
  hono/       @kitnai/hono   — Hono adapter (OpenAPI routes, plugin factory, Scalar docs)
  client/     @kitnai/client — browser utilities (SSE parsing, audio recording, TTS playback)
  cli/        @kitnai/cli    — CLI for the component registry (add, list, diff, update)
examples/
  api/            REST API server
  app/            Solid.js frontend
  voice/          Voice client
  getting-started/ Minimal getting-started example
```

**Dependency graph:** `hono` depends on `core`. `cli` and `client` are standalone.

## Architecture

- **`@kitnai/core`** is framework-agnostic — no HTTP types, pure TypeScript
- **`@kitnai/hono`** is a thin adapter that mounts OpenAPI routes onto a Hono app
- **`PluginContext`** is the central context object passed to all route factories. It holds registries (agents, tools, cards), storage, voice manager, model getter, and config.
- **`StorageProvider`** aggregates 7 sub-stores: `conversations`, `memory`, `skills`, `tasks`, `prompts`, `audio`, `commands`
- Implementations: `createFileStorage()` for file-based JSON, `createMemoryStorage()` for in-memory

## Import Conventions

- Always use `.js` extension in relative imports (TypeScript compiles to JS)
- Use `@kitnai/core` and `@kitnai/hono` for cross-package imports
- Use `ai` package for Vercel AI SDK types and functions (e.g. `tool()`, `streamText()`)

## Hono Route Pattern

Routes follow a `createXxxRoutes(ctx)` factory pattern split across two files:

1. **`<domain>.routes.ts`** — `createXxxRoutes(ctx: PluginContext)` returns an `OpenAPIHono` router with `createRoute()` + zod schemas
2. **`<domain>.handlers.ts`** — `createXxxHandlers(ctx: PluginContext)` returns named handler functions
3. **Mount in `packages/hono/src/plugin.ts`**: `app.route("/<domain>", createXxxRoutes(ctx))`

Reference: `packages/hono/src/routes/memory/` (memory.routes.ts + memory.handlers.ts)

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

## Key Types

- `PluginContext` — central context (registries, storage, model getter)
- `AIPluginConfig` — plugin configuration (model, storage, voice, etc.)
- `StorageProvider` — aggregates 6 sub-stores (see `packages/core/src/storage/interfaces.ts`)
- `AgentRegistration` / `ToolRegistration` — registered agent/tool definitions

## Lockfile

CI uses `bun install --frozen-lockfile`, which fails if `bun.lock` is stale. A pre-commit hook auto-runs `bun install` and stages `bun.lock` whenever a `package.json` is committed. If you're not using the hook (e.g. in CI or a fresh clone), run `bun install` manually and commit the lockfile before pushing.

## Recommended MCP Plugins

- **Context7** — use for up-to-date Vercel AI SDK, Hono, and Zod documentation
