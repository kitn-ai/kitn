# Creating & Publishing kitn Components

This guide covers the full workflow: creating components, building registry JSON, testing locally, deploying your own registry, and publishing updates.

## Quickstart

Create, build, and deploy a tool in under a minute:

```bash
# 1. Scaffold a new tool
kitn create tool my-api-tool
cd my-api-tool

# 2. Edit the source and metadata
#    - Implement your tool in my-api-tool.ts
#    - Fill in description, dependencies, envVars in registry.json

# 3. Build registry JSON
kitn build .

# 4. Deploy the output (dist/r/) to any static host
#    GitHub Pages, Vercel, Netlify, S3 — anything that serves JSON
```

Consumers install it by pointing at your registry:

```bash
kitn registry add @yourname https://yourname.github.io/registry/r/{type}/{name}.json
kitn add @yourname/my-api-tool
```

---

## Component Types

| Type | Use case | Source file |
|------|----------|-------------|
| `kitn:agent` | AI agent with system prompt and tool bindings | `.ts` |
| `kitn:tool` | Vercel AI SDK tool with zod schema | `.ts` |
| `kitn:skill` | Markdown instruction document injected into prompts | `.md` |
| `kitn:storage` | Persistence adapter (conversations, memory, etc.) | `.ts` |
| `kitn:package` | Multi-file package (full `src/` directory with `package.json`) | `src/**/*.ts` |

Use `kitn:agent`, `kitn:tool`, `kitn:skill`, or `kitn:storage` for standalone components (one or a few files). Use `kitn:package` for larger libraries like `@kitn/core` or `@kitn/routes` that have their own `package.json`.

---

## `kitn create` — Scaffolding

```bash
kitn create <type> <name>
```

Where `type` is one of: `agent`, `tool`, `skill`, `storage`.

### Examples

```bash
kitn create agent weather-agent
kitn create tool sentiment-analyzer
kitn create skill eli5
kitn create storage redis-store
```

Each command creates a directory with a `registry.json` and a starter source file:

```
weather-agent/
  registry.json        # Component metadata
  weather-agent.ts     # Starter source (agent config template)
```

### Generated templates

**Agent** — exports an `AgentConfig` with system prompt and empty tools array:

```ts
import type { AgentConfig } from "@kitn/core";

export const weatherAgentConfig: AgentConfig = {
  name: "weather-agent",
  description: "",
  system: "You are a helpful assistant.",
  tools: [],
};
```

**Tool** — exports a Vercel AI SDK `tool()` with zod schema and execute stub:

```ts
import { tool } from "ai";
import { z } from "zod";

export const sentimentAnalyzer = tool({
  description: "",
  inputSchema: z.object({
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    // TODO: implement
    return { result: input };
  },
});
```

**Skill** — Markdown with YAML frontmatter:

```markdown
---
name: eli5
description: ""
---

# Eli5

Describe what this skill does and how to use it.
```

**Storage** — exports a factory function returning a `StorageProvider`:

```ts
import type { StorageProvider } from "@kitn/core";

export function createRedisStore(config?: Record<string, unknown>): StorageProvider {
  // TODO: implement storage provider
  throw new Error("Not implemented");
}
```

After scaffolding, edit the source file and `registry.json`, then run `kitn build`.

---

## `registry.json` Reference

A `registry.json` file marks a directory as a kitn component. It contains metadata that `kitn build` uses to produce deployable JSON.

### Standalone component (no `package.json`)

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "name": "weather-tool",
  "type": "kitn:tool",
  "version": "1.0.0",
  "description": "Get current weather info using Open-Meteo API",
  "dependencies": ["ai", "zod"],
  "files": ["weather.ts"],
  "envVars": {
    "WEATHER_API_KEY": {
      "description": "API key for the weather service",
      "required": true,
      "secret": true,
      "url": "https://openweathermap.org/api"
    }
  },
  "categories": ["weather", "api"],
  "docs": "Assign to an agent or use directly via plugin.tools.register()."
}
```

When there is no `package.json`, the `name`, `version`, and `description` fields are required.

### Package component (has `package.json` alongside)

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "type": "kitn:package",
  "installDir": "routes",
  "registryDependencies": ["core"],
  "tsconfig": {
    "@kitn/routes": ["./index.ts"]
  },
  "exclude": ["lib/auth.ts"],
  "categories": ["http", "hono"],
  "docs": "Import with: import { ... } from '@kitn/routes'"
}
```

When `package.json` exists in the same directory, these fields are derived automatically:

| Field | Derived from |
|-------|-------------|
| `name` | `package.json` name (strips `@scope/` prefix) |
| `version` | `package.json` version |
| `description` | `package.json` description |
| `dependencies` | `package.json` dependencies + peerDependencies (names only) |
| `devDependencies` | `package.json` devDependencies (names only, excludes build tooling) |

Source files are read recursively from `src/` by default (override with `sourceDir`).

### Full field reference

| Field | Required | Derived from pkg.json | Description |
|-------|----------|----------------------|-------------|
| `$schema` | no | — | JSON schema URL for editor support |
| `type` | **yes** | — | `kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage`, `kitn:package` |
| `name` | if no pkg.json | yes | Component identifier (kebab-case) |
| `version` | if no pkg.json | yes | Semver version string |
| `description` | if no pkg.json | yes | Short one-line description |
| `dependencies` | no | yes | npm runtime dependencies |
| `devDependencies` | no | yes | npm dev dependencies |
| `registryDependencies` | no | — | Other kitn components this depends on |
| `files` | if not package | — | Source files to include (relative to directory) |
| `sourceDir` | no | — | Source directory override (default: `src/` for packages) |
| `installDir` | no | — | Target directory name when installed by consumers |
| `tsconfig` | no | — | TSConfig path aliases to add on install |
| `exclude` | no | — | Glob patterns to exclude from source scan (packages only) |
| `envVars` | no | — | Required environment variables (see below) |
| `categories` | no | — | Tags for filtering and discovery |
| `docs` | no | — | Post-install instructions shown in terminal |
| `changelog` | no | — | Array of `{ version, date, type, note }` entries |

### `envVars` — Environment Variables

Declare API keys and configuration that your component needs. Each entry is a key-value pair where the key is the environment variable name and the value describes it:

```json
{
  "envVars": {
    "WEATHER_API_KEY": {
      "description": "API key for the weather service",
      "required": true,
      "secret": true,
      "url": "https://openweathermap.org/api"
    },
    "WEATHER_BASE_URL": {
      "description": "Base URL for the weather API",
      "required": false,
      "secret": false
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `description` | — | **Required.** Human-readable description of the variable |
| `required` | `true` | Whether the component fails without this variable |
| `secret` | `true` | Whether the value is sensitive (affects prompt behavior during install) |
| `url` | — | Link where users can obtain the value (shown during install) |

When a consumer runs `kitn add`, the CLI:

1. Writes missing variables to `.env.example` with descriptions (always safe to commit)
2. Prompts the user to enter values interactively
3. Writes entered values to `.env` (gitignored, actual secrets)

Secret variables use password-style input (hidden). Non-secret variables use normal text input.

### `changelog` — Version History

Track changes across versions:

```json
{
  "changelog": [
    { "version": "1.1.0", "date": "2026-02-25", "type": "feature", "note": "Added streaming support" },
    { "version": "1.0.0", "date": "2026-02-15", "type": "initial", "note": "Initial release" }
  ]
}
```

Valid `type` values: `initial`, `feature`, `fix`, `breaking`.

### Import paths in component source

When a component imports from a different component type (e.g., an agent importing a tool), use the `@kitn/` alias:

```ts
// In an agent's source file:
import { weatherTool } from "@kitn/tools/weather.js";
```

During `kitn add`, the CLI rewrites these to relative paths based on the consumer's `kitn.json` aliases. Always use `.js` extensions — TypeScript ESM resolves them at compile time.

| Alias | Resolves to |
|-------|-------------|
| `@kitn/agents/<file>` | Consumer's configured agents directory |
| `@kitn/tools/<file>` | Consumer's configured tools directory |
| `@kitn/skills/<file>` | Consumer's configured skills directory |
| `@kitn/storage/<file>` | Consumer's configured storage directory |

---

## `kitn build` — Building Registry JSON

```bash
kitn build [paths...] [--output <dir>]
```

Scans for `registry.json` files, reads source code, and produces deployable registry JSON that `kitn add` can consume.

### Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `paths...` | scan from cwd | Directories or glob patterns to build |
| `--output`, `-o` | `dist/r` | Output directory |

### Examples

```bash
kitn build                             # scan cwd for all registry.json files
kitn build .                           # build the current directory
kitn build packages/adapters/hono      # build one component
kitn build packages/*                  # build all packages (glob)
kitn build components/agents/*         # build all agents
kitn build packages/adapters/hono packages/core # build specific list
kitn build --output ./my-registry/r    # custom output directory
```

### What it does

1. **Discovers** components by finding `registry.json` files (skips `node_modules`, `dist`, `.git`)
2. **Resolves metadata** — merges `package.json` fields when present, validates required fields
3. **Reads source files** — recursively for packages (`src/`), from `files` array for standalone components
4. **Produces JSON** — embeds source as strings, sets `updatedAt` timestamp, validates against schema
5. **Writes output** — latest + versioned copies + registry index

### Output structure

```
dist/r/
  registry.json                    # index of all components
  agents/
    weather-agent.json             # latest version (always overwritten)
    weather-agent@1.0.0.json       # versioned copy (immutable, skipped if exists)
  tools/
    weather-tool.json
    weather-tool@1.0.0.json
  package/
    core.json
    core@1.0.0.json
```

This output directory is a complete, deployable registry. Serve it from any static host and point consumers at it.

### Versioning behavior

`kitn build` does **not** bump versions. It reads whatever version is in `package.json` or `registry.json` and builds with that. Version bumping is a deliberate decision made by the developer.

Versioned files (`name@version.json`) are immutable — if the file already exists, it is skipped. The latest file (`name.json`) is always overwritten.

---

## Testing Locally

Before deploying, test the full flow locally using a `file://` registry URL.

### 1. Build your component

```bash
kitn build . --output ./dist/r
```

### 2. Create a test project

```bash
mkdir test-project && cd test-project
bun init -y
kitn init
```

### 3. Point at your local build

Edit `kitn.json` in the test project to add a local registry:

```json
{
  "registries": {
    "@kitn": "https://registry.kitn.dev/r/{type}/{name}.json",
    "@local": "file:///absolute/path/to/your/dist/r/{type}/{name}.json"
  }
}
```

### 4. Install and verify

```bash
kitn add @local/my-api-tool
```

This runs the full install flow: fetches the JSON, copies source files, installs npm dependencies, prompts for env vars, and tracks in `kitn.json`.

### 5. Verify the installed files

Check that the source landed correctly and imports resolve. If your component has `registryDependencies`, verify those were installed too.

---

## Updating & Versioning

### Bumping a version

1. Update the version in `package.json` (for packages) or `registry.json` (for standalone components)
2. Optionally add a `changelog` entry
3. Run `kitn build`

The build creates both a new latest file and an immutable versioned copy.

### How consumers get updates

Consumers use existing CLI commands to check for and apply updates:

```bash
# See what changed between local files and the registry
kitn diff weather-tool

# Pull the latest version from the registry
kitn update weather-tool
```

`kitn diff` compares the consumer's local source against the latest registry version. `kitn update` re-fetches and applies changes (prompts on conflicts since the consumer may have modified the code).

### Version pinning

Consumers can install a specific version:

```bash
kitn add weather-tool@1.0.0
```

This fetches `weather-tool@1.0.0.json` instead of `weather-tool.json`, giving them an exact version.

---

## Deploying Your Registry

The `dist/r/` output from `kitn build` is a static directory. Deploy it anywhere that serves JSON files.

### GitHub Pages

```bash
# In your registry repo
cp -r dist/r/* ./r/
git add r/
git commit -m "update registry"
git push
# GitHub Pages serves from r/ directory
```

Consumers add it as:

```bash
kitn registry add @yourname https://yourname.github.io/your-repo/r/{type}/{name}.json
```

### Vercel / Netlify

Deploy the `dist/r/` directory as a static site. The URL pattern is:

```
https://your-site.vercel.app/{type}/{name}.json
```

### S3 / CloudFront

Upload `dist/r/` to an S3 bucket with static website hosting enabled:

```bash
aws s3 sync dist/r/ s3://your-bucket/r/ --content-type application/json
```

### Any static host

The only requirement is that the URL template `{type}/{name}.json` resolves correctly. For example, if you host at `https://example.com/registry/`, consumers use:

```bash
kitn registry add @yourname https://example.com/registry/{type}/{name}.json
```

---

## Registering with kitn

Consumers add your registry with `kitn registry`:

```bash
# Add a third-party registry
kitn registry add @yourname https://yourname.github.io/registry/r/{type}/{name}.json

# List configured registries
kitn registry list

# Remove a registry
kitn registry remove @yourname
```

After adding, consumers install components with the namespace prefix:

```bash
kitn add @yourname/my-api-tool
```

Components from the default `@kitn` registry don't need a prefix:

```bash
kitn add weather-agent    # from @kitn
```

### Optional: kitn directory listing

Authors can submit a PR to `kitn-ai/registry` to list their registry URL in a public directory for discoverability. This is purely optional — components work whether listed or not.

---

## Working with Packages

The `kitn:package` type is for multi-file libraries that have their own `package.json`. This is how `@kitn/core` and `@kitn/routes` are published to the kitn registry.

### Package vs standalone

| | Standalone | Package |
|---|-----------|---------|
| Files | Listed explicitly in `files` array | Auto-discovered from `src/` |
| Metadata | All in `registry.json` | Derived from `package.json` |
| Install | Single file per alias directory | Preserves directory structure under `base` alias |
| TSConfig | Not applicable | Adds path aliases for `@kitn/*` imports |

### Example: Publishing a package

Given this project structure:

```
my-framework/
  package.json          # name, version, description, dependencies
  registry.json         # kitn-specific metadata only
  src/
    index.ts
    routes/
      chat.ts
      tools.ts
    utils/
      helpers.ts
```

The `registry.json` only needs kitn-specific fields:

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "type": "kitn:package",
  "installDir": "my-framework",
  "tsconfig": {
    "@my/framework": ["./index.ts"]
  },
  "categories": ["framework"]
}
```

Running `kitn build .` reads all `.ts` files from `src/`, merges metadata from `package.json`, and produces the registry JSON.

---

## Examples

### Complete tool with API key

```
movie-tool/
  registry.json
  movie-tool.ts
```

**`registry.json`:**

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "name": "movie-tool",
  "type": "kitn:tool",
  "version": "1.0.0",
  "description": "Search movies and TV shows using TMDB API",
  "dependencies": ["ai", "zod"],
  "files": ["movie-tool.ts"],
  "envVars": {
    "TMDB_API_KEY": {
      "description": "TMDB API key for movie/TV data",
      "required": true,
      "secret": true,
      "url": "https://www.themoviedb.org/settings/api"
    }
  },
  "categories": ["entertainment", "api"],
  "docs": "Get your free TMDB API key at https://www.themoviedb.org/settings/api"
}
```

**`movie-tool.ts`:**

```ts
import { tool } from "ai";
import { z } from "zod";

export const movieTool = tool({
  description: "Search for movies and TV shows",
  inputSchema: z.object({
    query: z.string().describe("Movie or TV show title to search for"),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error("TMDB_API_KEY is not set");

    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    return data.results?.slice(0, 5).map((m: any) => ({
      title: m.title,
      year: m.release_date?.slice(0, 4),
      overview: m.overview,
      rating: m.vote_average,
    }));
  },
});
```

### Agent with tool dependency

```
movie-agent/
  registry.json
  movie-agent.ts
```

**`registry.json`:**

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "name": "movie-agent",
  "type": "kitn:agent",
  "version": "1.0.0",
  "description": "Movie recommendation agent using TMDB data",
  "registryDependencies": ["movie-tool"],
  "files": ["movie-agent.ts"],
  "categories": ["entertainment"],
  "changelog": [
    { "version": "1.0.0", "date": "2026-02-25", "type": "initial", "note": "Initial release" }
  ]
}
```

**`movie-agent.ts`:**

```ts
import { movieTool } from "@kitn/tools/movie-tool.js";

const SYSTEM_PROMPT = `You are a movie recommendation specialist. Use the movie search tool
to find films and TV shows based on user preferences. Provide personalized recommendations
with brief explanations of why each pick matches what the user is looking for.`;

export const MOVIE_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: { searchMovies: movieTool },
};
```

When a consumer runs `kitn add movie-agent`, the CLI automatically installs `movie-tool` first (via `registryDependencies`), prompts for the `TMDB_API_KEY`, writes `.env.example`, and copies both files.

---

## End-to-End Walkthrough

Here's the complete flow from idea to published component:

```bash
# 1. Create
kitn create tool sentiment-analyzer
cd sentiment-analyzer

# 2. Implement
#    Edit sentiment-analyzer.ts with your logic
#    Edit registry.json: add description, envVars, categories

# 3. Build
kitn build .
#    Output: dist/r/tools/sentiment-analyzer.json
#            dist/r/tools/sentiment-analyzer@0.1.0.json
#            dist/r/registry.json

# 4. Test locally
mkdir /tmp/test-project && cd /tmp/test-project
bun init -y && kitn init
# Add to kitn.json registries:
#   "@local": "file:///path/to/sentiment-analyzer/dist/r/{type}/{name}.json"
kitn add @local/sentiment-analyzer
# Verify files installed correctly

# 5. Deploy
cd /path/to/sentiment-analyzer
# Push dist/r/ to your static host (GitHub Pages, Vercel, etc.)

# 6. Share
# Tell consumers:
kitn registry add @yourname https://yourname.github.io/registry/r/{type}/{name}.json
kitn add @yourname/sentiment-analyzer

# 7. Update later
#    Edit source, bump version in registry.json
kitn build .
#    Push updated dist/r/ to your host
#    Consumers run: kitn diff sentiment-analyzer && kitn update sentiment-analyzer
```
