# @kitnai/cli-core

Pure logic layer for [kitn](https://github.com/kitn-ai/kitn) project management. This package contains all command implementations shared by the CLI ([`@kitnai/cli`](../cli/README.md)) and the MCP server ([`@kitnai/mcp-server`](../mcp-server/README.md)).

## Design Principles

- **No UI.** Zero dependency on `@clack/prompts`, `picocolors`, or any rendering library. Functions return structured data; the consumer decides how to present it.
- **No `process.exit`.** Errors are thrown as typed exceptions (e.g. `NotInitializedError`). The consumer catches and handles them.
- **All inputs upfront.** Every action function takes a single options object with everything it needs. No interactive prompts, no stdin reads.
- **Structured results.** Every action returns a typed result object (e.g. `AddResult`, `RemoveResult`, `DiffComponentResult`). Consumers inspect the result to decide what to show or what follow-up actions to take.
- **Caller responsibilities documented.** Each action's JSDoc lists what the consumer must handle: confirmation prompts, conflict resolution, npm installs, output formatting, etc.

## Actions

### Project setup

| Function | Description |
|----------|-------------|
| `initProject(opts)` | Initialize a kitn project: write `kitn.json`, patch tsconfig, create barrel + plugin files |
| `newProject(opts)` | Create a new project from a starter template (built-in or custom GitHub template) |
| `getProjectContext(opts)` | Gather project context from `kitn.json` and `kitn.lock` |
| `regenerateRules(opts)` | Generate AI coding rules files (AGENTS.md, .cursor/rules, etc.) |
| `getRulesConfig(cwd)` | Fetch the rules config for tool selection UI |

### Component management

| Function | Description |
|----------|-------------|
| `addComponents(opts)` | Install components from the registry with dependency resolution |
| `removeComponent(opts)` | Remove a single installed component |
| `removeMultipleComponents(opts)` | Remove multiple components in one operation |
| `removeOrphans(keys, cwd)` | Remove orphaned dependencies after component removal |
| `updateComponents(opts)` | Update installed components to the latest registry version |
| `createComponent(opts)` | Scaffold a new agent, tool, skill, storage, or cron from a template |
| `linkToolInProject(opts)` | Wire a tool into an agent's `tools` object (adds import + entry) |
| `unlinkToolInProject(opts)` | Remove a tool from an agent's `tools` object |
| `installFromLock(opts)` | Install components from `kitn.lock` at exact recorded versions (like `npm ci`) |

### Discovery

| Function | Description |
|----------|-------------|
| `listComponents(opts)` | List available and installed components from configured registries |
| `getComponentInfo(opts)` | Get full details about a component: docs, files, dependencies, changelog |
| `diffComponent(opts)` | Show differences between local files and the current registry version |
| `searchRegistry(opts)` | Search registries by name or description with relevance scoring |
| `outdatedComponents(opts)` | Compare installed versions against the latest in the registry |

### Dependency inspection

| Function | Description |
|----------|-------------|
| `whyComponent(opts)` | Explain why a component is installed by tracing reverse dependencies |
| `componentTree(opts)` | Build a dependency tree from the lock file |
| `renderTree(roots)` | Render a dependency tree as plain text with box-drawing characters |
| `doctorCheck(opts)` | Run health checks: config validity, file integrity, orphans, node_modules |

### Registry management

| Function | Description |
|----------|-------------|
| `addRegistry(opts)` | Add a third-party registry to the project configuration |
| `removeRegistry(opts)` | Remove a registry (returns affected components) |
| `listRegistries(opts)` | List all configured registries with URLs and metadata |

### Testing

| Function | Description |
|----------|-------------|
| `getTryContext(cwd)` | Read project config and return context needed to run tools/agents |
| `generateRunnerScript(baseDir)` | Generate the TypeScript runner script for executing tools/agents in-process |

### Disambiguation helpers

| Function | Description |
|----------|-------------|
| `parseTypeFilter(components, type?)` | Parse type filter from positional args (e.g. `kitn add agent weather`) |
| `fetchAllIndexItems(registries)` | Fetch all index items from all configured registries |
| `findDisambiguationCandidates(...)` | Find disambiguation candidates when multiple components share a name |
| `detectSlotConflicts(resolved, lock)` | Detect slot conflicts between resolved items and the current lock file |

## Key Exports

Beyond actions, the package exports utilities and types used across the CLI and MCP server:

### Errors

- `NotInitializedError` -- thrown when `kitn.json` is not found (has `.code = "NOT_INITIALIZED"` and `.cwd`)

### Config I/O

- `readConfig(cwd)` / `writeConfig(cwd, config)` -- read/write `kitn.json` with Zod validation
- `readLock(cwd)` / `writeLock(cwd, lock)` -- read/write `kitn.lock` (supports legacy flat format and v1 lockfile format)

### Types

- `KitnConfig`, `LockFile`, `RegistryEntry` -- config and lock file types
- `ComponentType`, `RegistryItem`, `RegistryIndex` -- registry data types
- `configSchema`, `lockSchema`, `registryItemSchema` -- Zod schemas for validation

### Installers

- `rewriteKitnImports(content, type, fileName, aliases)` -- rewrite `@kitn/*` imports to project-relative paths
- `createBarrelFile()` / `addImportToBarrel()` / `removeImportFromBarrel()` -- barrel file (`src/ai/index.ts`) management
- `linkToolToAgent()` / `unlinkToolFromAgent()` -- AST-free agent file manipulation
- `generateDiff()` / `FileStatus` -- unified diff generation
- `writeComponentFile()` / `checkFileStatus()` -- safe file writing with directory creation
- `patchTsconfig()` -- patch tsconfig.json with path aliases

### Registry

- `RegistryFetcher` -- fetch registry indices and component items
- `resolveDependencies()` -- transitive dependency resolution

### Rules

- `renderTemplate()` / `wrapContent()` -- rules template rendering
- `parseRulesSections()` / `findRelevantSections()` -- section extraction for topic-based help

### Utilities

- `parseComponentRef(input)` -- parse `@namespace/name@version` strings
- `contentHash(content)` -- SHA-256 content hash for integrity checking
- `toCamelCase()` / `toTitleCase()` -- naming convention helpers
- `resolveTypeAlias()` / `toComponentType()` -- map user-facing type names to `kitn:*` types
- `resolveToolByName()` / `resolveAgentByName()` -- find tools/agents in the project by name

## Usage

The CLI wrapper imports an action from `@kitnai/cli-core`, prompts for any missing inputs, calls the action, then formats the output:

```typescript
import { addComponents, NotInitializedError } from "@kitnai/cli-core";

try {
  const result = await addComponents({
    components: ["weather-agent"],
    cwd: process.cwd(),
  });

  // Handle file conflicts (prompt user)
  for (const conflict of result.fileConflicts) {
    // Show diff, ask to overwrite...
  }

  // Install npm dependencies
  if (result.npmDeps.length > 0) {
    // Run package manager install...
  }

  // Report results
  console.log(`Installed: ${result.installed.map((c) => c.name).join(", ")}`);
} catch (err) {
  if (err instanceof NotInitializedError) {
    console.error("Run 'kitn init' first.");
  }
}
```

The MCP server follows the same pattern but returns JSON instead of formatted output:

```typescript
import { getComponentInfo } from "@kitnai/cli-core";

const result = await getComponentInfo({
  component: "weather-agent",
  cwd: "/path/to/project",
});

return {
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
};
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `diff` | Unified diff generation for file comparisons |
| `zod` | Schema validation for config, lock files, and registry data |

## Related packages

- [`@kitnai/cli`](../cli/README.md) -- Interactive CLI (thin UI wrapper around cli-core)
- [`@kitnai/mcp-server`](../mcp-server/README.md) -- MCP server for AI coding assistants (thin protocol wrapper around cli-core)

## License

MIT
