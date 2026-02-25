# kitn Registry

Component registry for the kitn monorepo -- a catalog of pre-built agents, tools, skills, and storage components.

## What the Registry Contains

The registry holds **25 components** across four categories:

| Category | Type | Count |
|----------|------|-------|
| Agents | `kitn:agent` | 13 |
| Tools | `kitn:tool` | 5 |
| Skills | `kitn:skill` | 5 |
| Storage | `kitn:storage` | 2 |

## Available Components

### Agents

| Name | Description | Registry Dependencies |
|------|-------------|-----------------------|
| `coding-agent` | Code generation and execution agent with sandboxed JavaScript runtime | -- |
| `compact-agent` | Conversation compaction agent that summarizes verbose conversations into concise context blocks | -- |
| `guardrails-agent` | Guardrails finance advisor that classifies input before generating advice, blocking off-topic queries | -- |
| `hackernews-agent` | Hacker News analyst agent that fetches and presents trending tech stories | `hackernews-tool` |
| `human-in-loop-agent` | Agent that proposes actions for human approval before executing them | -- |
| `knowledge-agent` | Movie knowledge and recommendation agent powered by TMDB | `movies-tool` |
| `memory-agent` | Memory-enabled agent that saves and recalls information across conversations | -- |
| `recipe-agent` | Structured output recipe agent that generates complete recipes using generateObject with Zod schema | -- |
| `skills-agent` | Skills management agent that creates, edits, and manages behavioral skills for other agents | -- |
| `supervisor-agent` | Supervisor agent that routes queries to specialist agents and orchestrates parallel task execution | `weather-agent`, `hackernews-agent` |
| `taskboard-agent` | Task board agent that manages a Kanban board through natural language | -- |
| `weather-agent` | Weather specialist agent using Open-Meteo API data | `weather-tool` |
| `web-search-agent` | Web search specialist agent using Brave Search with page fetching and OpenGraph extraction | `web-search-tool`, `web-fetch-tool` |

### Tools

| Name | Description |
|------|-------------|
| `hackernews-tool` | Fetch top stories and story details from Hacker News via Firebase API |
| `movies-tool` | Search and get details for movies using The Movie Database (TMDB) API |
| `web-fetch-tool` | Fetch web pages and extract readable text content or OpenGraph metadata |
| `web-search-tool` | Search the web using Brave Search API and return structured results |
| `weather-tool` | Get current weather information for any location using Open-Meteo API |

### Skills

| Name | Description |
|------|-------------|
| `concise-summarizer` | Produces concise summaries with bullet points, leading with the direct answer |
| `eli5` | Explain Like I'm 5 -- simplifies complex topics using everyday analogies and plain language |
| `fact-check` | Verifies claims with evidence, flags confidence levels, and separates fact from belief |
| `pros-and-cons` | Balanced trade-off analysis with structured pros/cons and a clear recommendation |
| `step-by-step-reasoning` | Structured logical analysis with numbered steps, reasoning shown at each stage |

### Storage

| Name | Description |
|------|-------------|
| `conversation-store` | File-based JSON conversation storage with append, list, clear, and delete operations |
| `memory-store` | File-based namespaced key-value memory store for agent memory persistence |

## Registry Schema

### Registry Index (`r/registry.json`)

The index is the top-level manifest listing all available components (metadata only, no file content):

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "version": "1.0.0",
  "items": [
    {
      "name": "weather-agent",
      "type": "kitn:agent",
      "description": "Weather specialist agent using Open-Meteo API data",
      "registryDependencies": ["weather-tool"],
      "categories": ["weather", "api"],
      "version": "1.0.0"
    }
  ]
}
```

### Registry Item (`r/<type>/<name>.json`)

Each individual component JSON includes full source code in the `files` array:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique component identifier |
| `type` | Yes | One of `kitn:agent`, `kitn:tool`, `kitn:skill`, `kitn:storage` |
| `description` | Yes | Short description of the component |
| `files` | Yes | Array of `{ path, content, type }` objects with full source code |
| `dependencies` | No | npm package dependencies (e.g., `["ai"]`) |
| `devDependencies` | No | npm dev dependencies |
| `registryDependencies` | No | Other kitn components this depends on |
| `envVars` | No | Required environment variables with descriptions |
| `docs` | No | Post-install instructions shown in the terminal |
| `categories` | No | Tags for discovery and filtering |
| `version` | No | Semver version string (defaults to `1.0.0`) |

## Building the Registry

```bash
bun run build
```

This runs `scripts/build-registry.ts`, which:

1. Walks each type directory under `components/` (`agents`, `tools`, `skills`, `storage`)
2. Reads the `manifest.json` and source files from each component directory
3. Validates each component against the Zod schema in `src/schema.ts`
4. Writes individual component JSON files to `r/<type>/<name>.json`
5. Writes the combined index to `r/registry.json`

To validate the registry without rebuilding:

```bash
bun run validate
```

## Directory Structure

```
registry/
  components/              # Source components (input)
    agents/
      <name>/
        manifest.json      # Component metadata and file list
        <name>.ts          # Source file(s)
    tools/
      <name>/
        manifest.json
        <name>.ts
    skills/
      <name>/
        manifest.json
        README.md           # Skill definition in frontmatter + markdown
    storage/
      <name>/
        manifest.json
        <name>.ts
  r/                        # Built registry output
    registry.json           # Index of all components (metadata only)
    agents/<name>.json      # Full component with embedded source
    tools/<name>.json
    skills/<name>.json
    storage/<name>.json
  schema/                   # JSON Schema definitions
    registry.json           # Schema for the registry index
    registry-item.json      # Schema for individual component files
    config.json             # Schema for kitn.json project config
  scripts/
    build-registry.ts       # Build script
    validate-registry.ts    # Validation script
  src/
    schema.ts               # Zod schemas and TypeScript types
    schema.test.ts          # Schema tests
```

Each component lives in its own directory under `components/<type>/<name>/`. The `manifest.json` declares the component's metadata and lists which files to include. The build script reads these manifests, bundles the source code into the `files` array, and writes the output to `r/`.

## Monorepo

This package is part of the [kitn monorepo](../README.md).
