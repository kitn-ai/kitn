# `kitn build` & `kitn create` Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan generated from this design.

**Goal:** Let anyone package kitn components into registry-compatible JSON from any project, without needing the registry repo.

**Architecture:** A `registry.json` file marks a directory as a kitn component. `kitn build` scans for these files, reads source code, merges metadata from `package.json` when present, and produces deployable static JSON output. `kitn create` scaffolds new components with the right boilerplate.

**Tech Stack:** TypeScript, commander, @clack/prompts, zod (validation), bun:test

---

## Context

The current workflow for publishing to the kitn registry requires:
1. Cloning the registry repo
2. Hand-writing a `manifest.json`
3. Positioning repos so relative `sourceDir` paths resolve
4. Running a build script inside the registry repo
5. Committing and pushing built output

This is fragile, couples authoring to a specific repo layout, and makes it impractical for anyone outside the core team to publish components.

shadcn/ui solved this with `shadcn build` (CLI 3.0, August 2025): authors create a `registry.json`, run `shadcn build`, and deploy the output JSON anywhere. No central registry needed — the schema is the protocol.

kitn already has the federated consumer side (namespaced registries, `kitn registry add`, `kitn add @namespace/component`). What's missing is the producer side: a way to build registry JSON from any project.

---

## `registry.json` — Component Metadata File

A `registry.json` file marks a directory as a kitn component. It contains kitn-specific metadata that can't be expressed in `package.json`.

### For packages (multi-file, has `package.json` alongside)

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "type": "kitn:package",
  "installDir": "routes",
  "registryDependencies": ["core"],
  "tsconfig": {
    "@kitnai/hono": ["./index.ts"]
  },
  "exclude": ["lib/auth.ts"],
  "categories": ["http", "hono"],
  "docs": "Import with: import { ... } from '@kitnai/hono'"
}
```

When `package.json` exists alongside `registry.json`, these fields are derived automatically:
- `name` — from `package.json` name (strips `@scope/` prefix)
- `version` — from `package.json` version
- `description` — from `package.json` description
- `dependencies` — from `package.json` dependencies + peerDependencies (package names only, no versions)
- `devDependencies` — from `package.json` devDependencies (package names only)

Source files are read from `src/` by default (override with `sourceDir` field).

### For standalone components (single-file, no `package.json`)

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "name": "weather-tool",
  "type": "kitn:tool",
  "version": "1.0.0",
  "description": "Get current weather info using Open-Meteo API",
  "dependencies": ["ai", "zod"],
  "files": ["weather.ts"],
  "categories": ["weather", "api"],
  "docs": "Auto-registers on import. Assign to an agent or use directly."
}
```

When there is no `package.json`, `name`, `version`, and `description` are required in `registry.json`.

### Full schema

| Field | Required | Derived from pkg.json | Description |
|-------|----------|----------------------|-------------|
| `$schema` | no | — | JSON schema URL |
| `type` | **yes** | — | `kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage`, `kitn:package` |
| `name` | if no pkg.json | yes | Component identifier |
| `version` | if no pkg.json | yes | Semver version |
| `description` | if no pkg.json | yes | Short description |
| `dependencies` | no | yes | npm package dependencies |
| `devDependencies` | no | yes | npm dev dependencies |
| `registryDependencies` | no | — | Other kitn components this depends on |
| `files` | if not package | — | Source files to include (for single-file components) |
| `sourceDir` | no | — | Source directory override (default: `src/` for packages) |
| `installDir` | no | — | Target directory name when installed |
| `tsconfig` | no | — | TSConfig path aliases to add on install |
| `exclude` | no | — | Files to exclude from source scan (packages only) |
| `envVars` | no | — | Required environment variables with descriptions |
| `categories` | no | — | Categorization tags |
| `docs` | no | — | Post-install instructions shown in terminal |
| `changelog` | no | — | Array of `{ version, date, type, note }` entries |

---

## `kitn build` Command

Scans for `registry.json` files, reads source code, and produces deployable registry JSON.

### Usage

```
kitn build [paths...] [--output <dir>]
```

The `paths` argument accepts one or more directories or glob patterns. If omitted, scans from the current directory.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--output`, `-o` | `dist/r` | Output directory |

### Examples

```bash
kitn build                        # scan cwd for all registry.json files
kitn build packages/hono          # build only this component
kitn build packages/*             # build all packages (glob)
kitn build components/agents/*    # build all agents
kitn build packages/hono packages/core  # build specific list
```

### Behavior

```
$ kitn build

Scanning for registry.json files...
  Found packages/core/registry.json
  Found packages/hono/registry.json

Building 2 components...
  ✓ package/core.json
  ✓ package/core@1.0.0.json (versioned)
  ✓ package/hono.json
  ✓ package/hono@1.1.0.json (versioned)
  ✓ registry.json (2 components)

Output: dist/r/
```

```
$ kitn build packages/hono

Building 1 component...
  ✓ package/hono.json
  ✓ package/hono@1.1.0.json (versioned)
  ✓ registry.json (1 component)

Output: dist/r/
```

### Versioning

`kitn build` does not bump versions. It reads whatever version is in `package.json` or `registry.json` and builds with that. Version bumping is a deliberate release decision made by the developer — the build command never mutates source files.

The build is always a full rebuild of the targeted components. Running it twice with no source changes produces the same output (aside from `updatedAt` timestamp). Versioned files (`name@version.json`) are immutable — if the file already exists in the output directory, it is skipped.

### Step by step

1. **Discover components**:
   - If paths provided: look for `registry.json` in each path (expand globs first)
   - If no paths: walk directory tree from cwd, find all `registry.json` files. Skip `node_modules`, `dist`, `.git`, `r/`, `test/`, `tests/`.

2. **Resolve metadata** — for each `registry.json`:
   - Check for `package.json` in the same directory
   - If found: merge `name`, `version`, `description`, `dependencies`, `devDependencies`
   - If not found: validate that `name`, `version`, `description` exist in `registry.json`
   - Validate merged result against schema. Fail with clear error if anything missing.

3. **Read source files**:
   - For `kitn:package`: recursively read `.ts` files from `src/` (or `sourceDir`), apply `exclude` list
   - For other types: read files listed in the `files` array, relative to the `registry.json` directory

4. **Produce JSON** — for each component, produce a `RegistryItem`-compatible JSON object:
   - Embed source file contents as strings in the `files` array
   - Set `updatedAt` to current ISO timestamp
   - Validate against `registryItemSchema`

5. **Write output**:
   - `<output>/<typeDir>/<name>.json` — latest version (always overwritten)
   - `<output>/<typeDir>/<name>@<version>.json` — versioned copy (immutable: skip if file already exists)
   - `<output>/registry.json` — index with metadata for all built components

### Output structure

```
dist/r/
  registry.json                    # index of all components
  agents/
    weather-agent.json             # latest
    weather-agent@1.0.0.json       # immutable versioned copy
  tools/
    weather-tool.json
    weather-tool@1.0.0.json
  package/
    core.json
    core@1.0.0.json
    hono.json
    hono@1.1.0.json
```

This output directory is a complete, deployable registry. Serve it from any static host (GitHub Pages, Vercel, Netlify, S3) and point consumers at it.

---

## `kitn create` Command

Scaffolds a new component with `registry.json` and a starter source file.

### Usage

```
kitn create <type> <name>
```

Where `type` is one of: `agent`, `tool`, `skill`, `storage`.

### Example

```
$ kitn create agent weather-agent

Created:
  weather-agent/
    registry.json
    weather-agent.ts

Next: edit weather-agent.ts, then run kitn build
```

### Generated files per type

| Type | Files | Starter template |
|------|-------|-----------------|
| `agent` | `registry.json` + `<name>.ts` | Agent config with system prompt and empty tools array |
| `tool` | `registry.json` + `<name>.ts` | Tool with zod inputSchema and execute stub |
| `skill` | `registry.json` + `README.md` | Skill markdown with frontmatter |
| `storage` | `registry.json` + `<name>.ts` | StorageProvider implementation stub |

`kitn:package` is not supported by `kitn create` — packages are full projects with `package.json`, `src/`, tests, etc. That's a separate scaffolding concern for a future phase.

### Generated `registry.json`

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "name": "<name>",
  "type": "kitn:<type>",
  "version": "0.1.0",
  "description": "",
  "dependencies": [],
  "files": ["<source-file>"],
  "categories": []
}
```

Pre-filled with sensible defaults. Author edits description, adds dependencies as they build, runs `kitn build` when ready.

---

## Impact on the Registry Repo

The `kitn-ai/registry` repo simplifies from "source + build pipeline + output" to just "output + deployment":

**Remove:**
- `components/` directory (source files + manifests)
- `scripts/build-registry.ts` (replaced by `kitn build`)
- `scripts/validate-registry.ts` (validation moves to `kitn build`)
- `scripts/stage-registry.ts` (no longer needed)
- `src/schema.ts` (schema moves to CLI package)

**Keep:**
- `r/` directory (the built output)
- `schema/` directory (JSON Schema files served at kitn.dev)
- `.github/workflows/deploy.yml` (GitHub Pages deployment)
- `README.md`

**New workflow for updating the kitn registry:**

```bash
# In the kitn monorepo
cd ~/Projects/kitn-ai/kitn
# Edit source in packages/hono/src/
# Bump version in packages/hono/package.json
kitn build packages/hono --output ~/Projects/kitn-ai/registry/r

# In the registry repo
cd ~/Projects/kitn-ai/registry
git add r/
git commit -m "feat: update hono to 1.1.0"
git push
# GitHub Pages auto-deploys
```

The registry repo becomes a thin deployment target. All build logic lives in the CLI.

---

## What Stays the Same

- **Output format** — identical JSON the CLI already consumes. No changes to `kitn add`, `kitn list`, `kitn diff`, `kitn info`, etc.
- **Registry URL scheme** — `{type}/{name}.json` pattern unchanged
- **Versioned files** — immutable `@version.json` copies
- **`kitn.json` consumer config** — no changes
- **Federated model** — anyone builds their own JSON, deploys anywhere, consumers add the URL via `kitn registry add`

---

## End-to-End Example: Publishing a Custom Tool

```bash
# 1. Create a new tool
kitn create tool sentiment-analyzer
cd sentiment-analyzer

# 2. Edit the source
# ... write your tool logic in sentiment-analyzer.ts

# 3. Edit registry.json
# ... add description, dependencies, categories

# 4. Build
kitn build . --output ../my-registry/r

# 5. Deploy
cd ../my-registry
# push to GitHub Pages, Vercel, S3, wherever

# 6. Anyone can use it
kitn registry add @yourname https://yourname.github.io/my-registry/r/{type}/{name}.json
kitn add @yourname/sentiment-analyzer
```

No PRs. No gatekeepers. No central authority. The schema is the protocol.

---

## Optional: Discoverability via kitn Directory

Authors can optionally submit a PR to `kitn-ai/registry` to list their registry in a public directory for discoverability. This is purely optional — components work whether listed or not.

This is a future concern and not part of this implementation.
