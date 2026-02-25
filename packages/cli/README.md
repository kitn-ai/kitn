# @kitnai/cli

CLI for installing AI agent components from the kitn registry.

## Installation

```bash
# Run directly with npx
npx @kitnai/cli init

# Or install globally
npm install -g @kitnai/cli
kitn init
```

Works with any package manager:

```bash
bunx @kitnai/cli init
pnpm dlx @kitnai/cli init
```

## Commands

### `kitn init`

Initialize kitn in your project. Creates a `kitn.json` configuration file.

```bash
kitn init
```

Prompts for:
- **Runtime**: bun, node, or deno
- **Alias directories**: Where each component type gets installed (defaults to `src/agents`, `src/tools`, `src/skills`, `src/storage`)

Also offers to install `@kitnai/hono` as a dependency.

### `kitn add [components...]`

Add components from the registry. Resolves `registryDependencies` transitively.

```bash
# Add a single component
kitn add weather-agent

# Add multiple components
kitn add weather-agent hackernews-tool eli5

# Overwrite existing files without prompting
kitn add weather-agent --overwrite

# Filter interactive selection by type
kitn add --type agent
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-o, --overwrite` | Overwrite existing files without prompting |
| `-t, --type <type>` | Filter components by type when browsing |

When a file already exists and differs from the registry version, you'll see a unified diff and be prompted to keep your version or overwrite.

After installation, the CLI:
- Installs npm dependencies via your detected package manager
- Checks for missing environment variables
- Shows post-install documentation

### `kitn list`

List available and installed components from the registry.

```bash
# List all components
kitn list

# Only show installed components
kitn list --installed

# Filter by type
kitn list --type tool
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-i, --installed` | Only show installed components |
| `-t, --type <type>` | Filter by type (`agent`, `tool`, `skill`, `storage`) |

### `kitn diff <component>`

Show differences between your local version and the current registry version.

```bash
kitn diff weather-agent
```

Outputs a unified diff for each file in the component. Shows "up to date" if there are no differences.

### `kitn remove <component>`

Remove an installed component. Deletes files and removes tracking from `kitn.json`.

```bash
kitn remove weather-agent
```

Prompts for confirmation before deleting files.

### `kitn update [components...]`

Update installed components to the latest registry version.

```bash
# Update specific components
kitn update weather-agent weather-tool

# Update all installed components
kitn update
```

This re-fetches components from the registry and applies the same conflict resolution as `kitn add --overwrite`.

## Configuration

### `kitn.json`

Created by `kitn init`. Controls where components are installed and which registries to use.

```json
{
  "$schema": "https://kitn.dev/schema/config.json",
  "runtime": "bun",
  "aliases": {
    "agents": "src/agents",
    "tools": "src/tools",
    "skills": "src/skills",
    "storage": "src/storage"
  },
  "registries": {
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json"
  }
}
```

| Field | Description |
|-------|-------------|
| `runtime` | `bun`, `node`, or `deno` |
| `aliases` | Directory paths for each component type |
| `registries` | Named registries with URL templates |
| `installed` | Auto-managed tracking of installed components (don't edit manually) |

### Custom Registries

Add custom registries alongside or instead of the default:

```json
{
  "registries": {
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
    "@myteam": "https://registry.myteam.dev/r/{type}/{name}.json"
  }
}
```

The URL template uses `{type}` and `{name}` placeholders. Components are fetched by replacing these with the component's type directory (`agents`, `tools`, `skills`, `storage`) and name.

The registry index is fetched by replacing `{type}/{name}.json` with `registry.json` in the URL template.

## Package Manager Detection

The CLI automatically detects your package manager by checking for lockfiles in this order:

1. `bun.lock` / `bun.lockb` → bun
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → yarn
4. `package-lock.json` → npm

## How It Works

Components are **source code**, not packages. `kitn add` copies TypeScript files directly into your project. You own the code and can modify it freely.

The CLI tracks what it installed in `kitn.json` under `installed`, storing file paths and content hashes. This enables `kitn diff` to detect local changes and `kitn update` to apply registry updates.
