# @kitnai/cli

CLI for installing AI agent components from kitn registries.

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

Initialize kitn in your project. Creates `kitn.json`, installs the core engine and Hono routes, and sets up tsconfig path aliases.

```bash
kitn init
```

Prompts for:
- **Runtime**: bun, node, or deno
- **Install path**: Base directory for kitn components (defaults to `src/ai`)

After answering, the CLI automatically installs the core engine and HTTP routes into your project.

### `kitn add [components...]`

Add components from a registry. Resolves `registryDependencies` transitively.

```bash
# Add a single component
kitn add weather-agent

# Add multiple components
kitn add weather-agent hackernews-tool eli5

# Add from a third-party registry
kitn add @acme/custom-agent

# Add a specific version
kitn add weather-agent@1.2.0

# Overwrite existing files without prompting
kitn add weather-agent --overwrite

# Filter interactive selection by type
kitn add --type agent
```

Components from the default `@kitn` registry don't need a namespace prefix. Components from other registries use `@namespace/name` format.

Third-party components install into a namespace subdirectory (e.g. `src/ai/agents/acme/custom-agent.ts`).

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

List available and installed components from configured registries.

```bash
# List all components from all registries
kitn list

# Filter by type
kitn list agents
kitn list --type tool

# Only show installed components
kitn list --installed

# Filter by registry
kitn list --registry @acme

# Show version numbers
kitn list --verbose
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-i, --installed` | Only show installed components |
| `-t, --type <type>` | Filter by type (`agent`, `tool`, `skill`, `storage`, `package`) |
| `-r, --registry <namespace>` | Only show components from this registry |
| `-v, --verbose` | Show version numbers |

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

Re-fetches components from the registry and applies the same conflict resolution as `kitn add --overwrite`.

### `kitn info <component>`

Show details about a component from the registry.

```bash
# Default registry
kitn info weather-agent

# With namespace and version
kitn info @acme/tool@1.0.0
```

Displays the component's description, type, version, dependencies, files, and changelog.

### `kitn create <type> <name>`

Scaffold a new kitn component.

```bash
kitn create agent my-agent
kitn create tool my-tool
```

Creates a new component directory with a manifest and template source file.

### `kitn build`

Build registry JSON from components that have `registry.json` manifests.

```bash
# Scan from current directory
kitn build

# Specify directories and output
kitn build src/components --output dist/r
```

### `kitn registry`

Manage component registries.

```bash
# Add a registry with metadata
kitn registry add @acme https://acme.dev/r/{type}/{name}.json \
  --homepage https://acme.dev \
  --description "Acme AI components"

# Add a plain registry (URL only)
kitn registry add @myteam https://registry.myteam.dev/r/{type}/{name}.json

# List configured registries (shows URL, homepage, description)
kitn registry list

# Remove a registry
kitn registry remove @myteam

# Overwrite an existing registry
kitn registry add @myteam https://new-url.dev/r/{type}/{name}.json --overwrite

# Remove the default @kitn registry (requires --force)
kitn registry remove @kitn --force
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `add <namespace> <url>` | Add a registry. Options: `-o` overwrite, `--homepage`, `--description` |
| `list` | List all configured registries with URLs and metadata |
| `remove <namespace>` | Remove a registry. `-f` required to remove `@kitn` |

The URL template uses `{type}` and `{name}` placeholders. Components are fetched by replacing these with the component's type directory (`agents`, `tools`, `skills`, `storage`, `package`) and name. The registry index is fetched by replacing `{type}/{name}.json` with `registry.json`.

## Configuration

### `kitn.json`

Created by `kitn init`. Controls where components are installed and which registries to use.

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
    "@kitn": {
      "url": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
      "homepage": "https://kitn.ai",
      "description": "Official kitn AI agent components"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `runtime` | `bun`, `node`, or `deno` |
| `framework` | `hono` |
| `aliases` | Directory paths for each component type |
| `registries` | Named registries — each value is a URL string or an object with `url`, `homepage`, `description` |
| `installed` | Auto-managed tracking of installed components (don't edit manually) |

### Registry entries

Registry entries can be a plain URL string or a rich object:

```json
{
  "registries": {
    "@kitn": {
      "url": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
      "homepage": "https://kitn.ai",
      "description": "Official kitn AI agent components"
    },
    "@myteam": "https://registry.myteam.dev/r/{type}/{name}.json"
  }
}
```

Both formats are supported. The CLI stores a rich object when `--homepage` or `--description` is provided, and a plain string otherwise.

## Package Manager Detection

The CLI automatically detects your package manager by checking for lockfiles in this order:

1. `bun.lock` / `bun.lockb` → bun
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → yarn
4. `package-lock.json` → npm

## How It Works

Components are **source code**, not packages. `kitn add` copies TypeScript files directly into your project. You own the code and can modify it freely.

The CLI tracks what it installed in `kitn.json` under `installed`, storing file paths and content hashes. This enables `kitn diff` to detect local changes and `kitn update` to apply registry updates.

### Hosting your own registry

Any HTTP server that serves JSON files matching the registry schema can be a kitn registry. See the [registry documentation](https://github.com/kitn-ai/registry) for the schema specification and instructions on registering your registry in the public directory.
