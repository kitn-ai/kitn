# Creating Components for the kitn Registry

This guide covers how to create and contribute components to the kitn registry.

## Component Types

kitn supports four component types:

| Type | Alias | Description |
|------|-------|-------------|
| `kitn:agent` | `agents` | AI agent configurations with system prompts and tool bindings |
| `kitn:tool` | `tools` | AI SDK tools that agents can call |
| `kitn:skill` | `skills` | Markdown instruction documents injected into agent prompts |
| `kitn:storage` | `storage` | Persistence adapters (conversations, memory, etc.) |

## Component Anatomy

Every component lives in `registry/components/<type>/<name>/` and contains:

```
registry/components/agents/weather-agent/
  manifest.json       # Component metadata
  weather-agent.ts    # Source file(s)
```

The `manifest.json` declares everything the CLI needs to install the component. Source files contain the actual implementation.

## Manifest Reference

```jsonc
{
  "name": "weather-agent",           // Unique identifier (kebab-case)
  "type": "kitn:agent",              // One of the 4 component types
  "description": "Weather specialist agent using Open-Meteo API data",
  "dependencies": ["ai"],            // npm packages to install
  "devDependencies": [],             // npm devDependencies (optional)
  "registryDependencies": ["weather-tool"],  // Other kitn components this needs
  "envVars": {},                     // Required environment variables (key: description)
  "files": ["weather-agent.ts"],     // Source files to install
  "docs": "Post-install instructions shown in the terminal.",
  "categories": ["weather", "api"]   // Tags for filtering/discovery
}
```

### Field Details

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique kebab-case identifier. Must match the directory name. |
| `type` | Yes | `kitn:agent`, `kitn:tool`, `kitn:skill`, or `kitn:storage` |
| `description` | Yes | Short one-line description |
| `dependencies` | No | npm packages the component needs at runtime |
| `devDependencies` | No | npm packages needed only for development |
| `registryDependencies` | No | Names of other kitn components this depends on. The CLI resolves these transitively. |
| `envVars` | No | Map of `ENV_VAR_NAME` to description string. The CLI warns if these are missing after install. |
| `files` | Yes | Array of filenames (relative to the component directory) |
| `docs` | No | Post-install message shown in terminal after adding the component |
| `categories` | No | Tags for filtering and discovery in `kitn list` |

## Examples by Type

### Agent

Agents export a configuration object with a system prompt and tool bindings.

**`manifest.json`**:
```json
{
  "name": "weather-agent",
  "type": "kitn:agent",
  "description": "Weather specialist agent using Open-Meteo API data",
  "dependencies": ["ai"],
  "registryDependencies": ["weather-tool"],
  "envVars": {},
  "files": ["weather-agent.ts"],
  "docs": "The weather agent uses the weather tool to fetch and present weather data.",
  "categories": ["weather", "api"]
}
```

**`weather-agent.ts`**:
```ts
import { weatherTool } from "../tools/weather.js";

const SYSTEM_PROMPT = `You are a weather specialist agent...`;

export const WEATHER_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
};
```

Agents reference their tools via relative imports. The `registryDependencies` field ensures the tool gets installed first.

### Tool

Tools use the [Vercel AI SDK `tool()` function](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling) with a Zod input schema.

**`manifest.json`**:
```json
{
  "name": "weather-tool",
  "type": "kitn:tool",
  "description": "Get current weather for any location using Open-Meteo API",
  "dependencies": ["ai", "zod"],
  "registryDependencies": [],
  "envVars": {},
  "files": ["weather.ts"],
  "docs": "The weather tool auto-registers on import.",
  "categories": ["weather", "api"]
}
```

**`weather.ts`**:
```ts
import { tool } from "ai";
import { z } from "zod";

export const weatherTool = tool({
  description: "Get current weather information for a location.",
  inputSchema: z.object({
    location: z.string().describe("City name or location"),
  }),
  execute: async ({ location }) => {
    // Fetch weather data...
    return { location, temperature: { celsius: 22 } };
  },
});
```

### Skill

Skills are Markdown documents with YAML frontmatter. They get injected into agent system prompts at runtime.

**`manifest.json`**:
```json
{
  "name": "eli5",
  "type": "kitn:skill",
  "description": "Simplifies complex topics using everyday analogies",
  "dependencies": [],
  "registryDependencies": [],
  "envVars": {},
  "files": ["README.md"],
  "docs": "Inject this skill when the user asks for simple explanations.",
  "categories": ["explanation", "beginner"]
}
```

**`README.md`**:
```markdown
---
name: eli5
description: Use when the user asks to explain something simply
tags: [simple, explanation, beginner, analogy]
phase: response
---

# Explain Like I'm 5

## When to Use
- User says "explain simply", "in plain English", "ELI5"

## Instructions
1. **Use everyday analogies**
2. **Avoid jargon completely**
3. **Start with the big picture**
```

The `phase` field controls when the skill is applied:
- `query` — injected before the agent processes the user's message
- `response` — applied during synthesis/formatting of the response
- `both` — injected at both stages

### Storage

Storage adapters implement persistence interfaces (conversations, memory, etc.).

**`manifest.json`**:
```json
{
  "name": "conversation-store",
  "type": "kitn:storage",
  "description": "File-based JSON conversation storage",
  "dependencies": [],
  "registryDependencies": [],
  "envVars": {},
  "files": ["conversation-store.ts"],
  "docs": "Call createConversationStore(dataDir) with a path to your data directory.",
  "categories": ["storage", "conversations", "persistence"]
}
```

Storage components export a factory function that creates the store instance:

```ts
export function createConversationStore(dataDir: string): ConversationStore {
  // Implementation...
}
```

## Naming Conventions

- **Component name**: `kebab-case`, must match directory name (e.g., `weather-agent`)
- **Directory**: `registry/components/<type>/<name>/` (e.g., `registry/components/agents/weather-agent/`)
- **Source files**: Use descriptive names matching the component (e.g., `weather-agent.ts`, `weather.ts`)
- **Agent suffix**: Agent names should end with `-agent` (e.g., `weather-agent`, not `weather`)
- **Tool names**: Tool names describe their function (e.g., `weather-tool`, `web-search-tool`)

## Registry Dependencies

When your component depends on another kitn component, use `registryDependencies`:

```json
{
  "registryDependencies": ["weather-tool"]
}
```

The CLI resolves these transitively and installs them in topological order using Kahn's algorithm. If `weather-agent` depends on `weather-tool`, running `kitn add weather-agent` automatically installs `weather-tool` first.

Circular dependencies are detected and rejected at install time.

## Environment Variables

If your component requires environment variables (e.g., API keys), declare them in `envVars`:

```json
{
  "envVars": {
    "OPENROUTER_API_KEY": "API key for OpenRouter (https://openrouter.ai)"
  }
}
```

After installation, the CLI checks for missing env vars and displays a warning with the description.

## Import Paths

**This is the most common source of confusion when writing registry components.**

Source files in the registry are authored with import paths that target the **installed layout**, not their location in the registry. For example:

```
# In the registry, these files are far apart:
registry/components/agents/weather-agent/weather-agent.ts
registry/components/tools/weather-tool/weather.ts

# But after `kitn add`, they're adjacent:
src/agents/weather-agent.ts
src/tools/weather.ts
```

So the weather agent imports its tool like this:

```ts
import { weatherTool } from "../tools/weather.js";
```

This path is **wrong** for the registry layout but **correct** after installation. Your IDE's auto-import will suggest the registry-relative path, which is NOT what you want. You must write the path as it will resolve in the user's project.

The `.js` extension is correct — TypeScript ESM resolves `weather.js` to `weather.ts` at compile time.

## Local Testing

### Build the registry

```bash
cd registry
bun run build
```

This runs `scripts/build-registry.ts`, which:
1. Walks `components/{agents,tools,skills,storage}/`
2. Reads each `manifest.json` and its listed source files
3. Validates against the Zod schema
4. Writes individual component JSON to `r/<type>/<name>.json`
5. Writes the registry index to `r/registry.json`

### Validate imports

```bash
cd registry
bun run validate
```

This runs `scripts/validate-registry.ts`, which simulates the installed directory layout and verifies that every relative import in every `.ts` file resolves to an actual file in the registry. It catches:

- **Broken import paths** — typos, wrong directory depth, missing extensions
- **Missing registryDependencies** — importing a file from a component that isn't declared as a dependency
- **Nonexistent registryDependencies** — declaring a dependency on a component that doesn't exist

Example error output:

```
✗ weather-agent → agents/weather-agent.ts
  import "../tools/nonexistent.js" resolves to "tools/nonexistent.ts" which is not in the registry
  hint: did you mean "tools/weather.ts" from component "weather-tool"?
  hint: "weather-tool" is not in registryDependencies — add it to manifest.json
```

Always run `bun run validate` after writing or modifying component source files.

### Validate manifests

If your manifest has schema errors, `bun run build` will fail with a Zod validation error. Common issues:
- Missing required fields (`name`, `type`, `description`, `files`)
- Invalid `type` value (must be one of the 4 `kitn:*` types)
- Files listed in `files` that don't exist on disk

### Test installation locally

You can point the CLI at a local registry for testing:

```json
{
  "registries": {
    "@kitn": "file:///path/to/kitn/registry/r/{type}/{name}.json"
  }
}
```

Then run `kitn add your-component` to test the full install flow.

## Submitting a Component

1. Fork the repository and create a feature branch
2. Create your component directory under `registry/components/<type>/<name>/`
3. Add `manifest.json` and all source files
4. Run `cd registry && bun run validate` to verify import paths
5. Run `cd registry && bun run build` to validate manifests and build the registry
6. Run `bun test` from the repo root to ensure nothing is broken
7. Submit a pull request with:
   - A description of what the component does
   - Any external API dependencies or requirements
   - Example usage showing how to wire it into a server
