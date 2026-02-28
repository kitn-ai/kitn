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
# Interactive (prompts for runtime and base directory)
kitn init

# Non-interactive with flags
kitn init --runtime bun --base src/ai

# Accept all defaults (runtime=bun, base=src/ai)
kitn init -y
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-r, --runtime <runtime>` | Runtime to use (`bun`, `node`, `deno`) — skips runtime prompt |
| `-b, --base <path>` | Base directory for components (default: `src/ai`) — skips path prompt |
| `-y, --yes` | Accept all defaults without prompting |

When flags are provided, the corresponding prompts are skipped. This enables scripting and CI usage.

After setup, the CLI automatically installs the core engine and HTTP routes into your project.

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

# Type-first syntax — specify the type before the name
kitn add agent weather
kitn add tool weather

# Filter by type with the --type flag
kitn add --type agent weather
```

Components from the default `@kitn` registry don't need a namespace prefix. Components from other registries use `@namespace/name` format.

When multiple components share the same name but differ in type (e.g., a `weather` agent and a `weather` tool), you'll be prompted to choose which to install. Use the type-first syntax or `--type` flag to skip the prompt.

Third-party components install into a namespace subdirectory (e.g. `src/ai/agents/acme/custom-agent.ts`).

**Flags:**

| Flag | Description |
|------|-------------|
| `-o, --overwrite` | Overwrite existing files without prompting |
| `-t, --type <type>` | Filter by component type during resolution |

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

Remove an installed component. Deletes files and removes tracking from `kitn.lock`.

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

Creates a new component file with a template and wires it into the barrel file (`src/ai/index.ts`).

### `kitn link`

Wire a tool into an agent's `tools` object. Adds the import statement and tools entry automatically.

```bash
# Fully explicit
kitn link tool weather --to general-agent

# With a custom key name
kitn link tool weather --to general-agent --as getWeather

# Interactive — pick tool, then agent
kitn link
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--to <agent>` | Target agent name (interactive if omitted) |
| `--as <key>` | Key name in the tools object (defaults to the export name) |

### `kitn unlink`

Remove a tool from an agent's `tools` object. Removes the import if it's no longer referenced.

```bash
# Fully explicit
kitn unlink tool weather --from general-agent

# Interactive — pick tool, then agent
kitn unlink
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--from <agent>` | Target agent name (interactive if omitted) |

### `kitn rules`

Generate or regenerate AI coding assistant rules files (e.g. `AGENTS.md`, `.cursor/rules/kitn.mdc`).

```bash
kitn rules
```

Prompts you to select which AI coding tools you use, then fetches the latest rules template from the registry and generates the corresponding files. Works in any directory — uses project aliases from `kitn.json` if available, otherwise uses defaults.

### `kitn chat <message>`

AI-powered scaffolding assistant. Describe what you need in plain English and the assistant will generate a plan to add, create, link, or remove components.

```bash
# Basic usage
kitn chat "I want a weather agent with a tool"

# Override the chat service URL
kitn chat "add a calculator tool" --url http://localhost:4002
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--url <url>` | Chat service URL (overrides config and default) |

The chat service URL is resolved in this order:
1. `--url` flag
2. `KITN_CHAT_URL` environment variable
3. User config (`~/.kitn/config.json` `chat-url` key)
4. Project config (`kitn.json` `chatService.url`)
5. Default: `https://chat.kitn.dev`

### `kitn config`

Manage user-level configuration stored at `~/.kitn/config.json`.

```bash
# Set a config value
kitn config set chat-url https://chat.acme.com
kitn config set api-key sk_my_secret_key

# Get a config value
kitn config get chat-url

# List all config values
kitn config list
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `set <key> <value>` | Set a config value |
| `get <key>` | Get a config value |
| `list` | List all config values |

**Valid keys:**

| Key | Description |
|-----|-------------|
| `chat-url` | Chat service URL for `kitn chat` |
| `api-key` | API key for authenticated chat service requests |

API key values are masked in output for security.

### `kitn build`

Build registry JSON from components that have `registry.json` manifests.

```bash
# Scan from current directory
kitn build

# Specify directories and output
kitn build src/components --output dist/r
```

### `kitn check`

Check for CLI updates.

```bash
kitn check
```

Shows the current version and whether a newer version is available on npm.

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

> Installed component tracking (file paths, content hashes, versions) is stored separately in `kitn.lock`. This file is auto-managed — don't edit it manually.

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

The CLI tracks what it installed in `kitn.lock`, storing file paths and content hashes. This enables `kitn diff` to detect local changes and `kitn update` to apply registry updates.

### Hosting your own registry

Any HTTP server that serves JSON files matching the registry schema can be a kitn registry. See the [registry documentation](https://github.com/kitn-ai/registry) for the schema specification and instructions on registering your registry in the public directory.
