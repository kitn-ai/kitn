# Design: Layer B — Source-Installable Packages

## Context

Layer A extracted `@kitnai/core` and renamed `@kitnai/server` → `@kitnai/hono`. Both packages live in the monorepo and work via `workspace:*` dependencies.

Layer B makes these packages installable as **source** via the CLI, so users in standalone projects can run `kitn add core` and `kitn add routes` to get the full engine and HTTP layer as owned source code — same philosophy as shadcn/ui.

## Decision Summary

| Decision | Choice |
|----------|--------|
| Install granularity | Whole package only (no sub-module installs) |
| Wizard for optional features | No — install everything, user deletes what they don't need |
| tsconfig patching | Auto-patch by CLI |
| Directory structure | Single base directory, everything under it |
| Framework selection | Captured in `kitn init`, `kitn add routes` resolves to correct adapter |
| Auth middleware | Removed from hono package — app responsibility |
| Package naming in CLI | `kitn add core`, `kitn add routes` (not `kitn add hono`) |

## kitn.json Schema Changes

```json
{
  "$schema": "https://kitn.dev/schema/config.json",
  "runtime": "bun",
  "framework": "hono",
  "aliases": {
    "base": "src/ai",
    "agents": "src/ai/agents",
    "tools": "src/ai/tools",
    "skills": "src/ai/skills",
    "storage": "src/ai/storage"
  },
  "registries": {
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json"
  },
  "_installed": {}
}
```

New fields:
- `framework` — `"hono" | "cloudflare" | "elysia" | "fastify" | "express"` (only `hono` supported initially)
- `aliases.base` — root install directory (all other aliases derive from it)

## `kitn init` Flow

```
$ kitn init

Welcome to kitn!

Runtime?              [bun / node / deno]
Framework?            [hono / cloudflare (coming soon) / elysia (coming soon) / fastify (coming soon) / express (coming soon)]
Install directory?    [src/ai]
```

Three prompts. Aliases auto-derive from the base directory:
- `base` → user's answer (default `src/ai`)
- `agents` → `{base}/agents`
- `tools` → `{base}/tools`
- `skills` → `{base}/skills`
- `storage` → `{base}/storage`

The old init flow (4 separate directory prompts, offer to `npm install @kitnai/hono`) is replaced entirely.

## New Component Type: `kitn:package`

Added to the registry schema alongside existing types (`kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage`).

Differences from regular components:
1. Multiple files with preserved directory structure
2. `tsconfig` field specifying path aliases to register
3. `installDir` field — directory name under the base alias (e.g. `"core"`, `"routes"`)
4. Can be a `registryDependency` of other packages

### Registry JSON Format

```json
{
  "$schema": "https://kitn.dev/schema/registry-item.json",
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine",
  "dependencies": ["ai", "zod"],
  "registryDependencies": [],
  "installDir": "core",
  "tsconfig": {
    "@kitnai/core": ["./index.ts"]
  },
  "files": [
    { "path": "core/index.ts", "content": "...", "type": "kitn:package" },
    { "path": "core/types.ts", "content": "...", "type": "kitn:package" },
    { "path": "core/agents/orchestrator.ts", "content": "...", "type": "kitn:package" }
  ],
  "version": "1.0.0"
}
```

The `tsconfig.paths` values are relative to the install directory. The CLI resolves them to the full path based on the `base` alias (e.g. `@kitnai/core` → `["./src/ai/core/index.ts"]`).

### Hono Package (installed as `routes`)

```json
{
  "name": "hono",
  "type": "kitn:package",
  "description": "Hono HTTP adapter with routes for kitn agents",
  "dependencies": ["hono", "@hono/zod-openapi", "@scalar/hono-api-reference"],
  "registryDependencies": ["core"],
  "installDir": "routes",
  "tsconfig": {
    "@kitnai/hono": ["./index.ts"]
  },
  "files": [
    { "path": "routes/index.ts", "content": "...", "type": "kitn:package" },
    { "path": "routes/plugin.ts", "content": "...", "type": "kitn:package" },
    { "path": "routes/routes/agents/agents.routes.ts", "content": "...", "type": "kitn:package" }
  ],
  "version": "1.0.0"
}
```

Note: `auth.ts` is excluded. Auth is the app's responsibility.

### `kitn add routes` Resolution

The CLI maps `kitn add routes` to the correct adapter package via `config.framework`:
- `"hono"` → fetch `package/hono` from registry, install to `{base}/routes/`
- `"cloudflare"` → fetch `package/cloudflare` (future), install to `{base}/routes/`

The user never types the framework-specific package name.

`kitn add core` is direct — no framework resolution needed.

## `kitn add` Changes for Packages

When the resolved component has `type: "kitn:package"`:

1. **Resolve dependencies** — e.g. `routes` depends on `core`, install core first
2. **Determine target directory** — `{base}/{installDir}` (e.g. `src/ai/core/`)
3. **Write files** — preserve directory structure (create subdirs as needed)
4. **Patch tsconfig.json** — read existing tsconfig, merge paths entries, write back
5. **Install npm deps** — via detected package manager
6. **Track in `_installed`** — same as regular components (version, files, hash)

### tsconfig Patching

The CLI reads `tsconfig.json` from the project root, ensures `compilerOptions.paths` exists, and merges the package's `tsconfig` entries with resolved paths:

```json
{
  "compilerOptions": {
    "paths": {
      "@kitnai/core": ["./src/ai/core/index.ts"],
      "@kitnai/hono": ["./src/ai/routes/index.ts"]
    }
  }
}
```

If paths already exist, they are overwritten for the package being installed (not for unrelated entries).

## Registry Build Changes

The build script currently scans `registry/components/{type}/{name}/` for manifest + source files. For packages, it reads from the actual monorepo source:

- `core` → reads from `packages/core/src/` (all `.ts` files, preserving directory structure)
- `hono` → reads from `packages/hono/src/` (excluding `lib/auth.ts`)

Package manifests live at `registry/components/package/core/manifest.json` and `registry/components/package/hono/manifest.json`. These point to the monorepo source via a `sourceDir` field rather than listing individual files:

```json
{
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine",
  "sourceDir": "../../packages/core/src",
  "installDir": "core",
  "dependencies": ["ai", "zod"],
  "tsconfig": {
    "@kitnai/core": ["./index.ts"]
  },
  "version": "1.0.0"
}
```

The build script recursively reads all `.ts` files from `sourceDir`, embeds their content, and outputs the full registry JSON.

### Auth Removal

As part of this work, `packages/hono/src/lib/auth.ts` is deleted. Any references to `createApiKeyAuth` in the hono package's `index.ts` and route files are removed. The hono manifest excludes this file.

## Schema Changes (registry/src/schema.ts)

```ts
// Add to componentType enum
export const componentType = z.enum([
  "kitn:agent",
  "kitn:tool",
  "kitn:skill",
  "kitn:storage",
  "kitn:package",  // NEW
]);

// Add to registryItemSchema
export const registryItemSchema = z.object({
  // ... existing fields ...
  installDir: z.string().optional(),  // NEW — directory name for packages
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),  // NEW — paths to add
});

// Add framework to config
export const frameworkType = z.enum(["hono", "cloudflare", "elysia", "fastify", "express"]);

export const configSchema = z.object({
  runtime: runtimeType,
  framework: frameworkType,  // NEW
  aliases: z.object({
    base: z.string(),  // NEW
    agents: z.string(),
    tools: z.string(),
    skills: z.string(),
    storage: z.string(),
  }),
  registries: z.record(z.string(), z.string()),
  _installed: z.record(z.string(), installedComponentSchema).optional(),
});
```

## Installed Directory Structure

After `kitn init` + `kitn add core` + `kitn add routes` + `kitn add weather-agent`:

```
project/
  kitn.json
  tsconfig.json          ← patched with @kitnai/core and @kitnai/hono paths
  src/ai/
    core/                ← @kitnai/core source
      index.ts
      types.ts
      agents/
        orchestrator.ts
        execute-task.ts
        run-agent.ts
        memory-tool.ts
      registry/
        agent-registry.ts
        tool-registry.ts
        handler-factories.ts
      streaming/
        sse-writer.ts
        stream-helpers.ts
      storage/
        interfaces.ts
        file-storage/
        in-memory/
      events/
      voice/
      utils/
      schemas/
    routes/              ← @kitnai/hono source (framework-specific)
      index.ts
      plugin.ts
      types.ts
      adapters/
        request-adapter.ts
      lib/
        configure-openapi.ts
      routes/
        health/
        agents/
        tools/
        generate/
        memory/
        skills/
        conversations/
        voice/
    agents/              ← installed components
      weather-agent.ts
    tools/
    skills/
    storage/
```

## What's NOT in This Layer

- Module-level granularity (`kitn add core/voice`) — whole package only
- Multiple framework adapters — only hono, others show "coming soon"
- `kitn check` / `kitn status` — deferred to Layer C
- Registry versioning (`kitn add core@1.0.0`) — deferred to Layer C
- Rollback support — deferred
