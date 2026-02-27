# kitn Registry

This directory contains the component registry — the source manifests and the built JSON files that get published to GitHub Pages for `kitn add` / `kitn update` to consume.

## Directory Structure

```
registry/
  components/           # Source manifests + component files
    agents/             #   e.g. weather-agent/manifest.json
    tools/
    skills/
    storage/
    package/            #   core, hono — multi-file packages
  r/                    # Built output (served by GitHub Pages)
    agents/             #   weather-agent.json, weather-agent@1.0.0.json
    tools/
    skills/
    storage/
    package/            #   core.json, core@1.0.0.json, core@1.1.0.json
    registry.json       #   Master index with all component metadata
  scripts/              # Build, validate, and staging scripts
  src/                  # Shared schema definitions
```

## How Versioning Works

Each component has a `manifest.json` that defines its metadata, including `version` and `changelog`.

### Manifest format (regular component)

```json
{
  "name": "weather-agent",
  "type": "kitn:agent",
  "description": "Weather specialist agent",
  "files": ["weather-agent.ts"],
  "registryDependencies": ["core", "weather-tool"],
  "version": "1.0.0",
  "changelog": [
    { "version": "1.0.0", "date": "2026-02-25", "type": "initial", "note": "Initial release" }
  ]
}
```

### Manifest format (package component)

Packages like `core` and `hono` pull source from the monorepo `packages/` directory:

```json
{
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine",
  "sourceDir": "../../../../packages/core/src",
  "installDir": "core",
  "dependencies": ["ai", "zod"],
  "exclude": ["test/**"],
  "version": "1.1.0",
  "changelog": [
    { "version": "1.1.0", "date": "2026-02-27", "type": "breaking", "note": "Remove initialize()" },
    { "version": "1.0.0", "date": "2026-02-25", "type": "initial", "note": "Initial release" }
  ]
}
```

### Changelog entry types

| Type | Meaning |
|------|---------|
| `initial` | First release |
| `feature` | New functionality |
| `fix` | Bug fix |
| `breaking` | Breaking change — requires user action |

## Bumping a Version

The easiest way to bump a component version is the interactive script:

```bash
bun run bump:registry          # interactive — pick component, version, changelog
bun run bump:registry core     # skip picker — bump a specific component
```

The script will:
1. Show a component picker (or use the positional arg)
2. Ask for bump type (patch / minor / major) with computed next versions
3. Ask for changelog type (feature / fix / breaking) — defaults based on bump type
4. Collect a changelog note
5. Update `manifest.json` with the new version and changelog entry
6. Optionally rebuild the registry

### Manual alternative

You can also edit manifests directly:

1. **Edit the manifest** — bump `version` and add a changelog entry at the top of the array:

   ```
   registry/components/{type}/{name}/manifest.json
   ```

   For packages (`core`, `hono`), the source files are read from `packages/*/src/` via the `sourceDir` path — you don't need to copy anything. Just change the code in `packages/` and bump the manifest version.

2. **Rebuild the registry:**

   ```bash
   bun run build:registry
   ```

   This generates:
   - `r/{type}/{name}.json` — latest version (always overwritten)
   - `r/{type}/{name}@{version}.json` — versioned snapshot (immutable, skipped if it already exists)
   - `r/registry.json` — master index with all components and their available versions

3. **Commit and push** — the `r/` directory is served by GitHub Pages. Once deployed, users see the new version.

### What users see

- **`kitn list`** — shows `↑X.X.X` next to components with a newer registry version
- **`kitn info <name>`** — shows all versions, changelog, and "Update available" notice
- **`kitn diff <name>`** — unified diff between local files and latest registry version
- **`kitn update`** — pulls latest versions for all (or specified) installed components

## Build Commands

```bash
# Build registry JSON from manifests (run from repo root)
bun run build:registry

# Validate that all component imports resolve correctly
bun run --cwd registry validate

# Stage package sources for typechecking
bun run --cwd registry stage
bun run --cwd registry typecheck
```

## How the Build Works

The build script (`scripts/build-registry.ts`):

1. Scans `components/{agents,tools,skills,storage,package}/` for `manifest.json` files
2. For regular components: reads the files listed in `manifest.files`
3. For packages: recursively reads all `.ts` files from `manifest.sourceDir`, applying `exclude` patterns
4. Rewrites monorepo imports (`@kitnai/core` → `@kitn/core`, `@kitnai/hono` → `@kitn/routes`)
5. Writes latest + versioned JSON to `r/`
6. Generates `r/registry.json` index by scanning existing `@version` files to build the `versions` array

### Import rewriting

The registry components use the published package names (`@kitn/core`, `@kitn/routes`), not the monorepo workspace names. The build script handles this automatically:

| Monorepo import | Registry output |
|----------------|-----------------|
| `@kitnai/core` | `@kitn/core` |
| `@kitnai/hono` | `@kitn/routes` |
| `@kitnai/hono-openapi` | `@kitn/routes` |

### Versioned file immutability

Once `{name}@{version}.json` is written, it is never overwritten. This ensures users can pin to a specific version with `kitn add core@1.0.0` and always get the same code. The un-versioned `{name}.json` always points to the latest.

## How Package Manifests Work

Package components (`kitn:package`) like `core`, `hono`, and `hono-openapi` work differently from regular components. They don't contain source files — they're **pointers** to source that lives in the monorepo's `packages/` directory.

### The problem they solve

The actual framework source code lives in `packages/core/src/`, `packages/hono/src/`, etc. These are developed and tested as normal TypeScript packages in the monorepo. But the registry needs to distribute that same code as copy-to-project files (like shadcn-ui). Package manifests bridge this gap — they tell the build script where to find the source, and the build script bundles it into a self-contained JSON artifact.

### Manifest → Build → Serve → Install

```
┌─────────────────────────────────────────────────────────────────┐
│ MONOREPO (development)                                          │
│                                                                 │
│  packages/core/src/          ← actual source code lives here    │
│    ├── index.ts                                                 │
│    ├── agents/                                                  │
│    │   ├── run-agent.ts                                         │
│    │   └── execute-task.ts                                      │
│    └── storage/                                                 │
│        └── interfaces.ts                                        │
│                                                                 │
│  registry/components/package/core/                              │
│    └── manifest.json         ← pointer: sourceDir → ../../..   │
│                                                                 │
│  bun run build:registry                                         │
│    1. Resolve sourceDir relative to manifest                    │
│    2. Read all .ts files recursively (minus excludes)           │
│    3. Rewrite imports: @kitnai/core → @kitn/core                │
│    4. Prefix paths with installDir: core/agents/run-agent.ts    │
│    5. Write self-contained JSON to r/                           │
│                                                                 │
│  registry/r/package/core.json       ← built artifact            │
│  registry/r/package/core@1.1.0.json ← immutable versioned copy  │
├─────────────────────────────────────────────────────────────────┤
│ GITHUB PAGES (serving)                                          │
│                                                                 │
│  Static JSON served at:                                         │
│  https://kitn-ai.github.io/kitn/r/package/core.json            │
│  https://kitn-ai.github.io/kitn/r/registry.json                │
├─────────────────────────────────────────────────────────────────┤
│ USER PROJECT (installation via `kitn add core`)                 │
│                                                                 │
│  CLI fetches core.json, resolves registryDependencies,          │
│  writes files to baseDir + file paths:                          │
│                                                                 │
│  my-project/src/ai/                                             │
│    ├── core/                  ← installDir becomes directory    │
│    │   ├── index.ts                                             │
│    │   ├── agents/                                              │
│    │   │   ├── run-agent.ts                                     │
│    │   │   └── execute-task.ts                                  │
│    │   └── storage/                                             │
│    │       └── interfaces.ts                                    │
│    └── routes/                ← hono's installDir               │
│        ├── index.ts                                             │
│        └── routes/                                              │
│            └── ...                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Key manifest fields for packages

| Field | Purpose | Example |
|-------|---------|---------|
| `sourceDir` | Relative path from manifest dir to source | `../../../../packages/core/src` |
| `installDir` | Directory name in user's project | `core` → files land at `src/ai/core/` |
| `dependencies` | npm packages to install | `["ai", "zod"]` |
| `registryDependencies` | Other kitn components to auto-fetch | `["core"]` (hono depends on core) |
| `exclude` | Glob patterns to skip | `["lib/auth.ts"]` |
| `tsconfig` | Path aliases for user's tsconfig | `{ "@kitn/core": ["core/*"] }` |

### How sourceDir resolves

The path is relative to the manifest file's directory:

```
registry/components/package/core/manifest.json
  sourceDir: "../../../../packages/core/src"

Resolves to:
  registry/components/package/core/ + ../../../../packages/core/src
  → packages/core/src/
```

This means the manifest doesn't duplicate any source code. Developers edit files in `packages/core/src/` normally, and the build script reads from there.

### Built JSON structure

The build output is a self-contained JSON file with all source inlined:

```json
{
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine",
  "version": "1.1.0",
  "installDir": "core",
  "dependencies": ["ai", "zod"],
  "registryDependencies": [],
  "files": [
    {
      "path": "core/index.ts",
      "content": "export { runAgent } from './agents/run-agent.js';\n...",
      "type": "kitn:package"
    },
    {
      "path": "core/agents/run-agent.ts",
      "content": "import { tool } from 'ai';\n...",
      "type": "kitn:package"
    }
  ]
}
```

Note that `path` is prefixed with `installDir` — this is how the CLI knows where to write each file in the user's project.

### How `kitn add` installs a package

When a user runs `kitn add hono`:

1. **Fetch** — CLI downloads `r/package/hono.json` from the registry
2. **Resolve dependencies** — `hono` declares `registryDependencies: ["core"]`, so CLI also fetches `core`. Dependencies are topologically sorted: `[core, hono]`
3. **Write files** — for each component, every file is written to `{baseDir}/{file.path}`:
   - `src/ai/core/index.ts`, `src/ai/core/agents/run-agent.ts`, ...
   - `src/ai/routes/index.ts`, `src/ai/routes/routes/...`, ...
4. **Install npm deps** — collects all `dependencies` across resolved components and runs `npm install`
5. **Track** — records installed versions and file paths in `kitn.json`

### Packages vs regular components

| | Packages (`kitn:package`) | Regular (`kitn:agent`, etc.) |
|---|---|---|
| Source in manifest | `sourceDir` → recursive directory read | `files` → explicit file list |
| File paths in JSON | Prefixed with `installDir` | Prefixed with type dir (`agents/`, `tools/`) |
| Import rewriting at build | Yes (`@kitnai/*` → `@kitn/*`) | No (files use `@kitn/*` already) |
| Import rewriting at install | No | Yes (`@kitn/tools/x` → relative paths) |
| Barrel auto-wiring | No | Yes (agents, tools, skills) |
| Typical file count | Many (entire package source tree) | 1-3 files |
