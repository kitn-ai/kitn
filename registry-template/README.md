# kitn registry template

A starter template for creating your own [kitn](https://kitn.dev) component registry. Think of it like [shadcn's registry-template](https://github.com/shadcn-ui/registry-template) — a clean-room starter for publishing your own agents, tools, skills, and storage providers that anyone can install with `kitn add`.

## Quick start

```bash
# 1. Clone or use as template
gh repo create my-registry --template kitn-ai/registry-template
cd my-registry

# 2. Install dependencies
bun install

# 3. Build the example components
bun run build

# 4. Validate imports resolve correctly
bun run validate

# 5. Type-check components
bun run typecheck
```

## Component types

| Type | Description | Source format |
|------|-------------|--------------|
| **agent** | AI agents with system prompts and tool bindings | `.ts` |
| **tool** | Functions agents can call (Vercel AI SDK `tool()`) | `.ts` |
| **skill** | Markdown instructions/prompts with YAML frontmatter | `.md` |
| **storage** | `StorageProvider` implementations | `.ts` |

## Creating a component

Each component lives in its own directory under `components/<type>/<name>/` with a `manifest.json` and source file(s).

### Agent

```
components/agents/my-agent/
  manifest.json
  my-agent.ts
```

**manifest.json:**
```json
{
  "name": "my-agent",
  "type": "kitn:agent",
  "description": "What this agent does",
  "version": "0.1.0",
  "files": ["my-agent.ts"],
  "categories": ["category"],
  "changelog": [
    { "version": "0.1.0", "date": "2025-01-01", "type": "initial", "note": "Initial release" }
  ]
}
```

**my-agent.ts:**
```ts
import { registerAgent } from "@kitn/core";

registerAgent({
  name: "my-agent",
  description: "What this agent does",
  system: "You are a helpful assistant.",
  tools: {},
});
```

### Tool

```
components/tools/my-tool/
  manifest.json
  my-tool.ts
```

**manifest.json:**
```json
{
  "name": "my-tool",
  "type": "kitn:tool",
  "description": "What this tool does",
  "version": "0.1.0",
  "dependencies": ["ai", "zod"],
  "files": ["my-tool.ts"],
  "categories": ["category"],
  "changelog": [
    { "version": "0.1.0", "date": "2025-01-01", "type": "initial", "note": "Initial release" }
  ]
}
```

**my-tool.ts:**
```ts
import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const myTool = tool({
  description: "What this tool does",
  parameters: z.object({
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    return { result: input };
  },
});

registerTool({
  name: "my-tool",
  description: "What this tool does",
  inputSchema: z.object({ input: z.string() }),
  tool: myTool,
});
```

### Skill

```
components/skills/my-skill/
  manifest.json
  README.md
```

**manifest.json:**
```json
{
  "name": "my-skill",
  "type": "kitn:skill",
  "description": "What this skill provides",
  "version": "0.1.0",
  "files": ["README.md"],
  "categories": ["category"],
  "changelog": [
    { "version": "0.1.0", "date": "2025-01-01", "type": "initial", "note": "Initial release" }
  ]
}
```

**README.md:**
```md
---
name: my-skill
description: What this skill provides
---

# My Skill

Instructions for the agent.
```

### Storage

```
components/storage/my-store/
  manifest.json
  my-store.ts
```

**manifest.json:**
```json
{
  "name": "my-store",
  "type": "kitn:storage",
  "description": "What this storage provider does",
  "version": "0.1.0",
  "files": ["my-store.ts"],
  "categories": ["category"],
  "changelog": [
    { "version": "0.1.0", "date": "2025-01-01", "type": "initial", "note": "Initial release" }
  ]
}
```

## Manifest reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique component identifier |
| `type` | yes | `kitn:agent`, `kitn:tool`, `kitn:skill`, or `kitn:storage` |
| `description` | yes | Short description shown in the registry |
| `version` | yes | Semver version string |
| `files` | yes | Array of source files in the component directory |
| `dependencies` | no | npm packages to install (e.g. `["ai", "zod"]`) |
| `devDependencies` | no | npm dev dependencies |
| `registryDependencies` | no | Other components from this registry that must be installed first |
| `envVars` | no | Required environment variables (`{ "API_KEY": "Description" }`) |
| `categories` | no | Tags for filtering in the registry UI |
| `docs` | no | Post-install instructions shown in the terminal |
| `changelog` | no | Array of changelog entries |

## Versioning

Each component has its own version in `manifest.json`. Use the interactive bump script:

```bash
bun run bump
```

This will:
1. Let you pick a component
2. Choose a bump type (patch, minor, major)
3. Select a change type (feature, fix, breaking)
4. Write a changelog note
5. Optionally rebuild the registry

Change types:
- **initial** — first release of a component
- **feature** — new functionality (minor bump)
- **fix** — bug fix (patch bump)
- **breaking** — breaking change (major bump)

## Building

```bash
bun run build
```

This reads all `components/` directories, bundles their source into JSON, and outputs:

```
r/
  registry.json              # index of all components
  agents/
    my-agent.json            # latest version
    my-agent@0.1.0.json      # immutable versioned copy
  tools/
    ...
```

The `r/` directory is your registry. It's static JSON — host it anywhere.

## Validation

```bash
bun run validate
```

Checks that all imports in your components resolve correctly in the installed layout. This catches the #1 mistake: writing import paths that work in the component directory but break after `kitn add`.

## Type-checking

```bash
bun run typecheck
```

This runs `bun run stage` (creates symlinks in `_staging/` that mirror the installed layout) then `tsc --noEmit`. Your `tsconfig.json` maps `@kitn/core` to type stubs in `_stubs/` and `@kitn/<type>/*` to the staging directory.

## Hosting

### GitHub Pages (included)

The `.github/workflows/deploy-registry.yml` workflow automatically builds and deploys to GitHub Pages on every push to `main`. Enable Pages in your repo settings (Settings > Pages > Source: GitHub Actions).

Your registry URL will be: `https://<user>.github.io/<repo>/r`

### Other static hosts

Run `bun run build`, then deploy the `r/` directory and `index.html` to any static host (Vercel, Netlify, Cloudflare Pages, S3, etc.).

## How users install from your registry

Users add your registry once, then install components by name:

```bash
# Add your registry
kitn registry add @yourname https://your-user.github.io/your-registry/r

# Install a component
kitn add @yourname/my-agent
```

## Scripts reference

| Script | Description |
|--------|-------------|
| `bun run build` | Build all components into `r/` |
| `bun run validate` | Validate import paths resolve correctly |
| `bun run stage` | Create `_staging/` symlinks for type-checking |
| `bun run typecheck` | Stage + type-check all components |
| `bun run bump` | Interactive version bump with changelog |
