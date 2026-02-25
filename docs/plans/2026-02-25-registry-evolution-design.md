# Design: Registry Evolution — Versioning, Changelog, Namespacing, and Repo Migration

## Context

The kitn registry serves components as static JSON on GitHub Pages. All components are currently at v1.0.0 with no changelog, no version pinning, no detail inspection before install, and no support for third-party registries. The registry also lives inside the main kitn monorepo, which will become a maintenance bottleneck as component contributions grow.

This design addresses all of these in one effort.

## Decision Summary

| Decision | Choice |
|----------|--------|
| Version storage | Versioned files: `name.json` (latest) + `name@version.json` (pinned) |
| Changelog location | In manifest.json, array of entries |
| Changelog entry types | `feature`, `fix`, `breaking`, `initial` |
| `updatedAt` format | ISO 8601 with time (`2026-02-25T16:30:00Z`) |
| Namespace syntax | `@namespace/name@version` prefix, defaults to `@kitn` |
| Registry hosting | Static JSON (GitHub Pages), architecture doesn't block future hosted API |
| Registry repo | Separate `kitn-ai/registry` repo |
| Package source sync | Snapshot at release time (option A) |
| Installed tracking key | `installed` (not `_installed`) |

## Registry Repo Migration

### New repo: `kitn-ai/registry`

```
registry/
  components/              # source manifests + files
    agents/
    tools/
    skills/
    storage/
    package/               # core and hono package manifests
  packages/                # snapshot of core/hono source (synced from main repo)
    core/src/
    hono/src/
  scripts/
    build-registry.ts      # builds r/ from components/
  src/
    schema.ts              # shared Zod schemas
  r/                       # built output, served via GitHub Pages
  README.md                # how to add components, schema docs, contribution guide
  package.json
```

Package manifests (`components/package/core/manifest.json`) point to `../../packages/core/src` instead of the monorepo path.

Source sync: when kitn cuts a release, the main repo's CI exports core/hono source to the registry repo's `packages/` directory. For the initial migration, we copy the source manually.

After migration, the `registry/` directory is removed from the main kitn repo.

## Schema Changes

### Manifest (component source)

```json
{
  "name": "weather-agent",
  "type": "kitn:agent",
  "version": "1.1.0",
  "description": "AI-powered weather lookup agent",
  "dependencies": ["ai", "zod"],
  "registryDependencies": ["weather-tool"],
  "files": ["weather-agent.ts"],
  "categories": ["utility", "api"],
  "changelog": [
    { "version": "1.1.0", "date": "2026-02-25", "type": "feature", "note": "Added streaming support" },
    { "version": "1.0.0", "date": "2026-02-15", "type": "initial", "note": "Initial release" }
  ]
}
```

New fields:
- `changelog` — array of `{ version, date, type, note }` entries
- `type` values: `"feature"`, `"fix"`, `"breaking"`, `"initial"`

### Built registry item (individual component JSON)

Same as manifest but with `updatedAt` auto-stamped by build script and full file content:

```json
{
  "name": "weather-agent",
  "type": "kitn:agent",
  "version": "1.1.0",
  "updatedAt": "2026-02-25T16:30:00Z",
  "changelog": [...],
  "files": [{ "path": "agents/weather-agent.ts", "content": "..." }]
}
```

### Registry index (registry.json)

Lightweight listing with version info:

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "version": "1.0.0",
  "items": [
    {
      "name": "weather-agent",
      "type": "kitn:agent",
      "version": "1.1.0",
      "versions": ["1.1.0", "1.0.0"],
      "updatedAt": "2026-02-25T16:30:00Z",
      "description": "AI-powered weather lookup agent",
      "registryDependencies": ["weather-tool"],
      "categories": ["utility", "api"]
    }
  ]
}
```

New fields on index items:
- `versions` — array of all available versions (newest first)
- `updatedAt` — timestamp of latest version

### kitn.json config

```json
{
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
    "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
    "@acme": "https://acme.github.io/kitn-components/r/{type}/{name}.json"
  },
  "installed": {
    "weather-agent": {
      "registry": "@kitn",
      "version": "1.1.0",
      "installedAt": "2026-02-25T16:30:00Z",
      "files": ["src/ai/agents/weather-agent.ts"],
      "hash": "abc12345"
    },
    "@acme/weather-agent": {
      "registry": "@acme",
      "version": "2.0.0",
      "installedAt": "2026-02-25T17:00:00Z",
      "files": ["src/ai/agents/weather-agent.ts"],
      "hash": "def67890"
    }
  }
}
```

Changes:
- `_installed` renamed to `installed`
- Each entry gets a `registry` field tracking which namespace it came from
- Default `@kitn` components use unnamespaced keys for backwards compat
- Third-party components use `@namespace/name` keys

## Versioned File Output

Build script outputs:

```
r/
  agents/
    weather-agent.json            # latest (always rebuilt)
    weather-agent@1.1.0.json      # versioned (immutable once published)
    weather-agent@1.0.0.json      # versioned (immutable once published)
  registry.json                   # index with latest versions
```

Rules:
- Unversioned file = latest, always overwritten on build
- Versioned files are never overwritten once they exist
- Build script checks for existing `@version` files and skips them

## Component Name Parsing

New utility `parseComponentRef`:

```
parseComponentRef("weather-agent")              → { namespace: "@kitn", name: "weather-agent", version: undefined }
parseComponentRef("weather-agent@1.0.0")        → { namespace: "@kitn", name: "weather-agent", version: "1.0.0" }
parseComponentRef("@acme/weather-agent")        → { namespace: "@acme", name: "weather-agent", version: undefined }
parseComponentRef("@acme/weather-agent@2.0.0")  → { namespace: "@acme", name: "weather-agent", version: "2.0.0" }
parseComponentRef("routes")                     → special case: resolved via config.framework
parseComponentRef("core")                       → { namespace: "@kitn", name: "core", version: undefined }
```

## Fetcher Changes

The fetcher resolves URLs using namespace + version:

```
Latest:  registries["@kitn"].replace("{type}", "agents").replace("{name}", "weather-agent")
         → https://kitn-ai.github.io/registry/r/agents/weather-agent.json

Pinned:  registries["@kitn"].replace("{type}", "agents").replace("{name}", "weather-agent@1.0.0")
         → https://kitn-ai.github.io/registry/r/agents/weather-agent@1.0.0.json

Third-party: registries["@acme"].replace("{type}", "agents").replace("{name}", "weather-agent")
             → https://acme.github.io/kitn-components/r/agents/weather-agent.json
```

The version is appended to the name before URL template substitution.

## New CLI Command: `kitn info`

```
$ kitn info weather-agent

  weather-agent v1.1.0                            @kitn
  AI-powered weather lookup agent

  Type:           agent
  Dependencies:   ai, zod
  Registry deps:  weather-tool
  Categories:     utility, api
  Updated:        2026-02-25T16:30:00Z

  Changelog:
    1.1.0  2026-02-25  feature  Added streaming support
    1.0.0  2026-02-15  initial  Initial release

  Files:
    agents/weather-agent.ts
```

Supports namespaces and versions:
- `kitn info @acme/weather-agent`
- `kitn info weather-agent@1.0.0`

Fetches the full component JSON and displays without installing.

## Updated CLI Commands

### `kitn list`

```
$ kitn list

  Agents
    ✓ weather-agent      v1.1.0  AI-powered weather lookup
    ✓ coding-agent       v1.0.0  Code generation agent          ⬆ v1.1.0 available
    ○ supervisor-agent   v2.0.0  Multi-agent orchestrator

  Tools
    ✓ weather-tool       v1.0.0  Get weather for a city
    ○ hackernews-tool    v1.0.0  Fetch top HackerNews stories

  Packages
    ✓ core               v1.0.0  Framework-agnostic engine
    ✓ hono               v1.0.0  Hono HTTP adapter

  3 installed, 2 available, 1 update available
```

Changes:
- Version shown next to each component
- Update indicator when installed version < registry latest
- Summary line at bottom
- Namespace shown when multiple registries configured

### `kitn add`

- Parses `@namespace/name@version` via `parseComponentRef`
- Fetches from correct registry based on namespace
- Appends `@version` to URL when version pinned
- Stores `registry` field in `installed` tracking

### `kitn update`

- `kitn update` (no args) — updates all installed components from their respective registries
- `kitn update weather-agent` — updates specific component
- `kitn update core` / `kitn update routes` — updates packages
- Compares installed version against registry latest

### `kitn diff`, `kitn remove`

- Both parse `@namespace/name` for third-party components
- Remove looks up namespace from `installed` entry

## Future Evolution (not in scope)

- **Hosted registry API** — Database-backed, user auth, `kitn publish`. The JSON contract between CLI and registry stays identical. A hosted API returns the same shape as static files.
- **Registry repo separation CI** — GitHub Action in main repo to auto-sync core/hono source to registry repo on release.
- **Version retention** — Policy for archiving old versions when the registry grows large.
