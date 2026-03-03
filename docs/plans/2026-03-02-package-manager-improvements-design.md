# Package Manager Improvements Design

**Date:** 2026-03-02
**Status:** Approved
**Branch:** feature/package-manager-improvements

## Overview

Audit of kitn's component management system identified gaps when compared to real package managers. This design adds 6 new commands, splits the `add`/`install` semantics, and adds corresponding MCP server tools.

## Changes

### 1. `kitn install` + `add`/`install` Split

**Current:** `kitn install` is an alias for `kitn add`.
**New:** `kitn add` adds new components. `kitn install` reproduces installed state from `kitn.lock`.

#### `kitn install` behavior:
1. Read `kitn.lock`
2. For each entry, fetch the component at the **exact recorded version** from the registry
3. Write files to disk (skip if file exists and hash matches)
4. Collect all npm dependencies from resolved components
5. Auto-run package manager install for missing npm deps
6. Report: installed X components, Y files written, Z already up-to-date

#### `--frozen` flag (CI mode):
- Fail if any component can't be fetched at its exact version
- Fail if any file on disk has a different hash than recorded
- No lock file writes — purely read-only verification + installation

#### Core API:
```typescript
// packages/cli-core/src/commands/install.ts
export interface InstallOpts {
  cwd: string;
  frozen?: boolean;
}

export interface InstallResult {
  installed: Array<{ name: string; files: string[]; version: string }>;
  skipped: Array<{ name: string; reason: string }>;
  npmDeps: string[];
  npmDevDeps: string[];
  errors: Array<{ component: string; error: string }>;
}

export async function installFromLock(opts: InstallOpts): Promise<InstallResult>
```

### 2. `kitn outdated`

Shows which installed components have newer versions available.

```
$ kitn outdated

Component          Installed  Latest   Registry
weather-agent      1.0.0      1.1.0    @kitn
core               1.0.0      1.1.0    @kitn
hackernews-tool    1.0.0      1.0.0    @kitn     (up to date)

2 outdated, 1 up to date
```

#### Core API:
```typescript
// packages/cli-core/src/commands/outdated.ts
export interface OutdatedItem {
  name: string;
  installedVersion: string;
  latestVersion: string;
  namespace: string;
  type: string;
  isOutdated: boolean;
}

export interface OutdatedResult {
  items: OutdatedItem[];
  stats: { outdated: number; upToDate: number };
}

export async function outdatedComponents(opts: { cwd: string }): Promise<OutdatedResult>
```

Reuses `readLock` + `RegistryFetcher.fetchIndex()`.

### 3. `kitn search <query>`

Searches the registry by name, description, and categories.

```
$ kitn search weather

weather-agent (agent)    Weather information agent with forecast capabilities
weather-tool (tool)      Get current weather data for any city

2 results
```

#### Core API:
```typescript
// packages/cli-core/src/commands/search.ts
export interface SearchResultItem {
  name: string;
  type: string;
  description: string;
  namespace: string;
  version?: string;
  installed: boolean;
  score: number;
}

export interface SearchResult {
  items: SearchResultItem[];
}

export async function searchRegistry(opts: {
  query: string;
  cwd: string;
  type?: string;
}): Promise<SearchResult>
```

Case-insensitive matching against name, description, categories. Exact name matches rank highest, then partial name, then description.

### 4. `kitn why <component>`

Traces why a component is installed — which other components depend on it.

```
$ kitn why weather-tool

weather-tool is a dependency of:
  weather-agent (registryDependencies)
    └── supervisor-agent (registryDependencies)

weather-tool is a direct dependency of 1 component
```

If top-level:
```
$ kitn why supervisor-agent

supervisor-agent is a top-level install (not a dependency of any other component)
```

#### Core API:
```typescript
// packages/cli-core/src/commands/why.ts
export interface WhyResult {
  component: string;
  isInstalled: boolean;
  dependents: Array<{ name: string; type: string }>;
  isTopLevel: boolean;
  chain: string[][];
}

export async function whyComponent(opts: {
  component: string;
  cwd: string;
}): Promise<WhyResult>
```

Pure lock-file operation — no network needed. Builds reverse dependency map from `registryDependencies`.

### 5. `kitn tree`

Visualizes the dependency graph of all installed components.

```
$ kitn tree

supervisor-agent (agent)
├── weather-agent (agent)
│   └── weather-tool (tool)
├── hackernews-tool (tool)
└── core (package)

knowledge-agent (agent)
├── movies-tool (tool)
└── core (package) [deduped]

6 components, 2 root(s)
```

#### Core API:
```typescript
// packages/cli-core/src/commands/tree.ts
export interface TreeNode {
  name: string;
  type: string;
  children: TreeNode[];
  deduped: boolean;
}

export interface TreeResult {
  roots: TreeNode[];
  totalComponents: number;
}

export async function componentTree(opts: { cwd: string }): Promise<TreeResult>
```

Algorithm:
1. Read `kitn.lock`, build adjacency map from `registryDependencies`
2. Identify root nodes (not in any other component's `registryDependencies`)
3. Build tree from each root, marking duplicates as `[deduped]`
4. CLI wrapper renders tree characters (`├──`, `└──`, `│`)

### 6. `kitn doctor`

Verifies project integrity.

```
$ kitn doctor

✓ kitn.json is valid
✓ 12 components installed
✓ All files present on disk
⚠ weather-tool: local modifications detected
✗ movies-tool: missing file src/ai/tools/movies.ts
✓ npm dependencies satisfied

1 warning, 1 error
```

#### Core API:
```typescript
// packages/cli-core/src/commands/doctor.ts
export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string[];
}

export interface DoctorResult {
  checks: DoctorCheck[];
  stats: { pass: number; warn: number; fail: number };
}

export async function doctorCheck(opts: { cwd: string }): Promise<DoctorResult>
```

Checks:
1. **Config valid** — kitn.json parses against schema
2. **Lock readable** — kitn.lock parses against schema
3. **Files exist** — every file in every lock entry exists on disk (fail if missing)
4. **Hash integrity** — recompute content hash vs lock (warn if modified — users own the code)
5. **npm deps** — every npm dep declared by installed components exists in node_modules (fail if missing)
6. **Orphaned files** — files in component directories not tracked by lock (warn)

### 7. MCP Server Tools

Each command gets a corresponding MCP tool:

| CLI Command | MCP Tool | Key Params |
|---|---|---|
| `kitn install` | `kitn_install` | `cwd`, `frozen?` |
| `kitn outdated` | `kitn_outdated` | `cwd` |
| `kitn search` | `kitn_registry_search` (already exists) | `query`, `cwd`, `type?` |
| `kitn why` | `kitn_why` | `component`, `cwd` |
| `kitn tree` | `kitn_tree` | `cwd` |
| `kitn doctor` | `kitn_doctor` | `cwd` |

## Files

### New (cli-core):
- `packages/cli-core/src/commands/install.ts`
- `packages/cli-core/src/commands/outdated.ts`
- `packages/cli-core/src/commands/search.ts`
- `packages/cli-core/src/commands/why.ts`
- `packages/cli-core/src/commands/tree.ts`
- `packages/cli-core/src/commands/doctor.ts`

### New (cli):
- `packages/cli/src/commands/install.ts`
- `packages/cli/src/commands/outdated.ts`
- `packages/cli/src/commands/search.ts`
- `packages/cli/src/commands/why.ts`
- `packages/cli/src/commands/tree.ts`
- `packages/cli/src/commands/doctor.ts`

### New (mcp-server):
- `packages/mcp-server/src/tools/install.ts`
- `packages/mcp-server/src/tools/outdated.ts`
- `packages/mcp-server/src/tools/why.ts`
- `packages/mcp-server/src/tools/tree.ts`
- `packages/mcp-server/src/tools/doctor.ts`

### Modified:
- `packages/cli/src/index.ts` — register new commands, remove `install` alias from `add`
- `packages/mcp-server/src/server.ts` — register new MCP tools
