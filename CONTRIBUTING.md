# Contributing to kitn

## Development Setup

```bash
# Clone and install
git clone https://github.com/kitn-ai/kitn.git
cd kitn
bun install

# Enable git hooks (auto-updates bun.lock when package.json changes)
git config core.hooksPath .hooks

# Verify everything works
bun run build
bun run test
bun run typecheck
```

## Fix Issues & Submit PRs

1. **Branch from `main`** using conventional prefixes:
   - `feat/short-description` -- new features
   - `fix/short-description` -- bug fixes
   - `docs/short-description` -- documentation
   - `refactor/short-description` -- code restructuring
   - `test/short-description` -- test additions/fixes

2. **Run checks before committing:**
   ```bash
   bun run build
   bun run test
   bun run typecheck
   ```

3. **Use conventional commit messages:**
   ```
   feat(core): add webhook trigger support
   fix(cli): resolve path on Windows
   docs: update storage provider guide
   refactor(hono): extract middleware helpers
   test(adapters): add elysia route tests
   ```
   The scope in parentheses is optional. Use the package name (`core`, `cli`, `hono`, `elysia`, `client`) or area (`registry`, `examples`).

4. **Open a PR** against `main`. Describe what changed and why. Link related issues.

## Create New Registry Components

Registry components are source files (like shadcn/ui) -- `kitn add` copies them into the user's project. They live in `registry/components/` organized by type:

```
registry/components/
  agents/          kitn:agent
  tools/           kitn:tool
  skills/          kitn:skill
  storage/         kitn:storage
  crons/           kitn:cron
  package/         kitn:package
```

### 1. Create the component directory

```bash
mkdir registry/components/tools/my-tool
```

### 2. Write a `manifest.json`

```json
{
  "name": "my-tool",
  "type": "kitn:tool",
  "description": "Short description of what this tool does",
  "dependencies": ["zod"],
  "registryDependencies": ["core"],
  "files": ["my-tool.ts"],
  "docs": "Usage hint shown after installation.",
  "categories": ["utility"],
  "changelog": [
    { "version": "1.0.0", "date": "2026-03-01", "type": "initial", "note": "Initial release" }
  ]
}
```

**Manifest fields:**

| Field | Required | Description |
|---|---|---|
| `name` | yes | Component name (kebab-case) |
| `type` | yes | One of `kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage`, `kitn:cron`, `kitn:package` |
| `description` | yes | Short description |
| `dependencies` | no | npm packages to install (e.g. `["zod", "ai"]`) |
| `devDependencies` | no | npm dev dependencies |
| `registryDependencies` | no | Other registry components this depends on (e.g. `["core", "weather-tool"]`) |
| `files` | yes* | Source files to include (* not needed for `kitn:package`) |
| `sourceDir` | no | For `kitn:package` only -- path to source directory relative to repo root |
| `installDir` | no | Target directory name in user project |
| `envVars` | no | Environment variables with description, required, secret flags |
| `docs` | no | Usage hint shown after `kitn add` |
| `categories` | no | Tags for discovery |
| `slot` | no | Exclusive slot -- components sharing a slot conflict |
| `version` | no | Semver string (defaults to `1.0.0`) |
| `changelog` | no | Array of `{ version, date, type, note }` entries |

### 3. Write the source files

Source files use the published `@kitn/*` import paths (not `@kitnai/*`):

```ts
import { createTool } from "@kitn/core";
```

The build script automatically rewrites `@kitnai/*` to `@kitn/*`, so if your source lives in the monorepo packages you can use either.

### 4. Build and verify

```bash
bun run build:registry
```

This outputs JSON to `registry/r/<type>/<name>.json`. Inspect the output to verify your component was built correctly.

## Create a Custom Registry

You can host your own component registry. A registry is a set of JSON files served over HTTPS.

### Structure

```
my-registry/
  r/
    agents/my-agent.json
    tools/my-tool.json
    registry.json          # index of all components
```

Each component JSON file follows the same schema as the official registry output. The easiest way to generate these is to use the same build script pattern -- create a `components/` directory with manifests, adapt `registry/scripts/build-registry.ts`, and run it.

### URL format

Registries use a URL template with `{type}` and `{name}` placeholders:

```
https://example.com/r/{type}/{name}.json
```

Users configure it in their `kitn.json`:

```json
{
  "$schema": "https://kitn.dev/schema/config.json",
  "registries": [
    {
      "name": "my-registry",
      "url": "https://example.com/r/{type}/{name}.json"
    }
  ]
}
```

The CLI resolves components by fetching `https://example.com/r/tools/my-tool.json` etc.

## Submit Components to the Official Registry

1. Fork the repo and create a branch.
2. Add your component under `registry/components/<type>/<name>/`:
   - `manifest.json` -- component manifest (see fields above)
   - Source files listed in `manifest.files`
3. Build and validate:
   ```bash
   bun run build:registry
   ```
4. Open a PR to `main`. Include a description of what the component does and any setup requirements.

## Testing

kitn uses `bun:test` for all tests.

```bash
bun run test                         # run all tests across all packages
bun run --cwd packages/core test     # run tests for a specific package
bun test path/to/test.ts             # run a single test file
```

### Conventions

- Test files go in `test/` directories or co-located as `*.test.ts`
- Use `describe`, `test`, and `expect` from `bun:test`
- Import test utilities directly:
  ```ts
  import { describe, test, expect } from "bun:test";
  ```

### Example

```ts
import { describe, test, expect } from "bun:test";
import { buildRegistryItem } from "../scripts/build-registry.js";

describe("buildRegistryItem", () => {
  test("builds a valid registry item from manifest", () => {
    const item = buildRegistryItem(manifest, files);
    expect(item.name).toBe("my-tool");
    expect(item.files).toHaveLength(1);
  });
});
```

## Build Pipeline Overview

The registry build (`bun run build:registry`) works as follows:

1. **Scan** `registry/components/` for directories containing `manifest.json`, organized by type subdirectory (`agents/`, `tools/`, `skills/`, `storage/`, `crons/`, `package/`).

2. **Read source files** listed in each manifest's `files` array. For `kitn:package` components, it recursively reads all `.ts` files from `sourceDir` instead.

3. **Rewrite imports** from internal workspace names (`@kitnai/core`) to published names (`@kitn/core`). This is done for package-type components whose source lives in `packages/`.

4. **Validate** the assembled item against the registry schema (`registryItemSchema`).

5. **Write output** to `registry/r/<type>/<name>.json` (latest) and `registry/r/<type>/<name>@<version>.json` (versioned, immutable -- not overwritten if it already exists).

6. **Generate index** at `registry/r/registry.json` listing all components with their metadata and available versions.

```
registry/
  components/          # source: manifests + code
    agents/
      weather-agent/
        manifest.json
        weather-agent.ts
  r/                   # output: built JSON
    agents/
      weather-agent.json
      weather-agent@1.0.0.json
    registry.json
  scripts/
    build-registry.ts  # the build script
```
