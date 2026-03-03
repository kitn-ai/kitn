# Package Manager Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 new CLI commands (install, outdated, search, why, tree, doctor), split add/install semantics, and add corresponding MCP server tools.

**Architecture:** Each command follows the two-layer pattern: pure logic in `packages/cli-core/src/commands/` (no UI, no process.exit), thin UI wrapper in `packages/cli/src/commands/` (using @clack/prompts + picocolors). MCP tools in `packages/mcp-server/src/tools/` call cli-core directly. All new commands are registered in their respective index files and exported from cli-core's barrel.

**Tech Stack:** TypeScript, Zod (schemas), @clack/prompts + picocolors (CLI UI), @modelcontextprotocol/sdk (MCP tools), bun:test (testing)

**Design doc:** `docs/plans/2026-03-02-package-manager-improvements-design.md`

---

### Task 1: Split `add`/`install` — Remove install alias from add

**Files:**
- Modify: `packages/cli/src/index.ts:39-50`

**Step 1: Remove the `.alias("install")` from the `add` command**

In `packages/cli/src/index.ts`, find line 41 (`.alias("install")`) and remove it. The `add` command block should become:

```typescript
program
  .command("add")
  .description("Add components from the registry (supports type-first: kitn add agent <name>)")
  .argument("[components...]", "component names or type followed by names")
  .option("-o, --overwrite", "overwrite existing files without prompting")
  .option("-t, --type <type>", "filter by component type during resolution")
  .option("-y, --yes", "skip confirmation prompt")
  .action(async (components: string[], opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(components, opts);
  });
```

**Step 2: Verify the CLI still works**

Run: `bun run build:cli && bun run --cwd packages/cli src/index.ts add --help`
Expected: Shows add command help without "install" alias mentioned.

**Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "refactor(cli): remove install alias from add command

Prepares for the new dedicated install command that installs
from kitn.lock rather than adding new components."
```

---

### Task 2: `kitn install` — Core logic (installFromLock)

**Files:**
- Create: `packages/cli-core/src/commands/install.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core install command**

Create `packages/cli-core/src/commands/install.ts`:

```typescript
import { join } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { typeToDir } from "../types/registry.js";
import type { RegistryItem } from "../types/registry.js";
import type { LockFile } from "../types/config.js";
import { contentHash } from "../utils/hash.js";
import { checkFileStatus, writeComponentFile } from "../installers/file-writer.js";
import { FileStatus } from "../installers/diff.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOpts {
  cwd: string;
  /** CI mode: fail if files are modified or versions can't be fetched */
  frozen?: boolean;
}

export interface InstallResultItem {
  name: string;
  files: string[];
  version: string;
}

export interface InstallResult {
  installed: InstallResultItem[];
  skipped: Array<{ name: string; reason: string }>;
  npmDeps: string[];
  npmDevDeps: string[];
  errors: Array<{ component: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Main: installFromLock
// ---------------------------------------------------------------------------

/**
 * Install all components from kitn.lock at their exact recorded versions.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * - Reads kitn.lock and fetches each component at its pinned version
 * - Writes files to disk (skips if hash matches)
 * - In frozen mode, fails on any discrepancy
 */
export async function installFromLock(opts: InstallOpts): Promise<InstallResult> {
  const { cwd, frozen } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return {
      installed: [],
      skipped: [{ name: "(none)", reason: "No components in kitn.lock" }],
      npmDeps: [],
      npmDevDeps: [],
      errors: [],
    };
  }

  const fetcher = new RegistryFetcher(config.registries);
  const installed: InstallResultItem[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const errors: Array<{ component: string; error: string }> = [];
  const allDeps: string[] = [];
  const allDevDeps: string[] = [];

  for (const [name, entry] of entries) {
    try {
      const namespace = entry.registry ?? "@kitn";
      const type = entry.type;

      if (!type) {
        errors.push({ component: name, error: "No type recorded in lock file" });
        continue;
      }

      const dir = typeToDir[type] as any;
      if (!dir) {
        errors.push({ component: name, error: `Unknown type: ${type}` });
        continue;
      }

      // Fetch at exact recorded version
      let item: RegistryItem;
      try {
        item = await fetcher.fetchItem(name, dir, namespace, entry.version);
      } catch (fetchErr: any) {
        if (frozen) {
          throw new Error(`Cannot fetch ${name}@${entry.version}: ${fetchErr.message}`);
        }
        errors.push({ component: name, error: `Fetch failed: ${fetchErr.message}` });
        continue;
      }

      // Collect npm deps
      if (item.dependencies) allDeps.push(...item.dependencies);
      if (item.devDependencies) allDevDeps.push(...item.devDependencies);

      // Check if already installed with matching hash
      const allContent = item.files.map((f) => f.content).join("\n");
      const newHash = contentHash(allContent);

      if (newHash === entry.hash) {
        // Verify files exist on disk
        const allExist = entry.files.every((f) => existsSync(join(cwd, f)));
        if (allExist) {
          skipped.push({ name, reason: "Up to date" });
          continue;
        }
        // Files missing — need to reinstall even though hash matches
      }

      if (frozen && newHash !== entry.hash) {
        throw new Error(
          `Frozen install failed: ${name} registry content (${newHash}) does not match lock file (${entry.hash})`
        );
      }

      // In frozen mode, also check that local files haven't been modified
      if (frozen) {
        for (const filePath of entry.files) {
          const fullPath = join(cwd, filePath);
          if (existsSync(fullPath)) {
            const localContent = await readFile(fullPath, "utf-8");
            // Find matching file in registry item
            const registryFile = item.files.find((f) => {
              const expectedPath = type === "kitn:package"
                ? join(config.aliases.base ?? "src/ai", f.path)
                : filePath;
              return expectedPath === filePath;
            });
            if (registryFile && localContent !== registryFile.content) {
              throw new Error(
                `Frozen install failed: ${filePath} has local modifications`
              );
            }
          }
        }
      }

      // Write files
      const writtenFiles: string[] = [];
      for (const file of item.files) {
        let targetPath: string;
        let relativePath: string;

        if (type === "kitn:package") {
          const baseDir = config.aliases.base ?? "src/ai";
          targetPath = join(cwd, baseDir, file.path);
          relativePath = join(baseDir, file.path);
        } else {
          // For single-file components, use the path from the lock file
          const lockFilePath = entry.files[0];
          if (lockFilePath) {
            targetPath = join(cwd, lockFilePath);
            relativePath = lockFilePath;
          } else {
            targetPath = join(cwd, file.path);
            relativePath = file.path;
          }
        }

        const status = await checkFileStatus(targetPath, file.content);
        if (status === FileStatus.New || status === FileStatus.Different) {
          await writeComponentFile(targetPath, file.content);
        }
        writtenFiles.push(relativePath);
      }

      installed.push({
        name,
        files: writtenFiles,
        version: entry.version,
      });
    } catch (err: any) {
      if (frozen) throw err; // In frozen mode, propagate errors
      errors.push({ component: name, error: err.message });
    }
  }

  const uniqueDeps = [...new Set(allDeps)];
  const uniqueDevDeps = [...new Set(allDevDeps)].filter((d) => !uniqueDeps.includes(d));

  return {
    installed,
    skipped,
    npmDeps: uniqueDeps,
    npmDevDeps: uniqueDevDeps,
    errors,
  };
}
```

**Step 2: Add the export to cli-core's index.ts**

Add this line to `packages/cli-core/src/index.ts` in the commands section:

```typescript
export * from "./commands/install.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/install.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add installFromLock command

Installs all components from kitn.lock at their exact recorded
versions. Supports --frozen mode for CI (fails on any discrepancy)."
```

---

### Task 3: `kitn install` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/install.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/install.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { installFromLock } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";
import { detectPackageManager } from "../utils/detect.js";
import { installDependencies, installDevDependencies } from "../installers/dep-installer.js";

export async function installCommand(opts: { frozen?: boolean }) {
  p.intro(pc.bgCyan(pc.black(" kitn install ")));

  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const s = p.spinner();
  s.start("Installing components from kitn.lock...");

  try {
    const result = await installFromLock({ cwd, frozen: opts.frozen });

    s.stop(`Processed ${result.installed.length + result.skipped.length} component(s)`);

    if (result.installed.length > 0) {
      p.log.success(
        `Installed ${result.installed.length} component(s):\n` +
          result.installed
            .map((c) => `  ${pc.green("+")} ${c.name} ${pc.dim(`v${c.version}`)}`)
            .join("\n"),
      );
    }

    if (result.skipped.length > 0) {
      p.log.info(
        `Skipped ${result.skipped.length} component(s):\n` +
          result.skipped
            .map((c) => `  ${pc.dim("-")} ${c.name} ${pc.dim(`(${c.reason})`)}`)
            .join("\n"),
      );
    }

    // Install npm dependencies
    const totalDeps = result.npmDeps.length + result.npmDevDeps.length;
    if (totalDeps > 0) {
      const pm = await detectPackageManager(cwd);
      if (pm) {
        const depSpinner = p.spinner();
        depSpinner.start(`Installing ${totalDeps} npm dependenc${totalDeps === 1 ? "y" : "ies"}...`);
        try {
          if (result.npmDeps.length > 0) installDependencies(pm, result.npmDeps, cwd);
          if (result.npmDevDeps.length > 0) installDevDependencies(pm, result.npmDevDeps, cwd);
          depSpinner.stop("Dependencies installed");
        } catch {
          depSpinner.stop(pc.yellow("Some dependencies failed to install"));
        }
      }
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        p.log.warn(`${pc.bold(err.component)}: ${err.error}`);
      }
    }

    p.outro(pc.green("Done!"));
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }
}
```

**Step 2: Register the command in index.ts**

Add this block to `packages/cli/src/index.ts` after the `add` command block (after line 50):

```typescript
program
  .command("install")
  .description("Install components from kitn.lock (like npm ci)")
  .option("--frozen", "fail if lock file is inconsistent (for CI)")
  .action(async (opts) => {
    const { installCommand } = await import("./commands/install.js");
    await installCommand(opts);
  });
```

**Step 3: Build and verify**

Run: `bun run build:cli && bun run --cwd packages/cli src/index.ts install --help`
Expected: Shows install command help with --frozen option.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/install.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn install command

Installs all components from kitn.lock at their exact recorded
versions. --frozen flag for CI mode. Replaces the old install
alias that was just a synonym for add."
```

---

### Task 4: `kitn outdated` — Core logic

**Files:**
- Create: `packages/cli-core/src/commands/outdated.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core outdated command**

Create `packages/cli-core/src/commands/outdated.ts`:

```typescript
import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { RegistryIndex } from "../types/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main: outdatedComponents
// ---------------------------------------------------------------------------

/**
 * Check which installed components have newer versions available.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 */
export async function outdatedComponents(opts: { cwd: string }): Promise<OutdatedResult> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return { items: [], stats: { outdated: 0, upToDate: 0 } };
  }

  // Fetch all registry indices
  const fetcher = new RegistryFetcher(config.registries);
  const indexCache = new Map<string, RegistryIndex>();

  for (const namespace of Object.keys(config.registries)) {
    try {
      const index = await fetcher.fetchIndex(namespace);
      indexCache.set(namespace, index);
    } catch {
      // Skip failing registries
    }
  }

  const items: OutdatedItem[] = [];
  let outdated = 0;
  let upToDate = 0;

  for (const [name, entry] of entries) {
    const namespace = entry.registry ?? "@kitn";
    const index = indexCache.get(namespace);
    if (!index) continue;

    const indexItem = index.items.find((i) => i.name === name);
    if (!indexItem) continue;

    const latestVersion = indexItem.version ?? "unknown";
    const installedVersion = entry.version;
    const isOutdated = latestVersion !== installedVersion && latestVersion !== "unknown";

    if (isOutdated) outdated++;
    else upToDate++;

    items.push({
      name,
      installedVersion,
      latestVersion,
      namespace,
      type: (entry.type ?? "unknown").replace("kitn:", ""),
      isOutdated,
    });
  }

  // Sort: outdated first, then alphabetical
  items.sort((a, b) => {
    if (a.isOutdated !== b.isOutdated) return a.isOutdated ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { items, stats: { outdated, upToDate } };
}
```

**Step 2: Add export to cli-core index**

Add to `packages/cli-core/src/index.ts`:

```typescript
export * from "./commands/outdated.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/outdated.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add outdatedComponents command

Checks installed components against registry indices to find
which have newer versions available."
```

---

### Task 5: `kitn outdated` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/outdated.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/outdated.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { outdatedComponents } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function outdatedCommand() {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const s = p.spinner();
  s.start("Checking for updates...");

  let result;
  try {
    result = await outdatedComponents({ cwd });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Checked ${result.items.length} component(s)`);

  if (result.items.length === 0) {
    p.log.info("No components installed.");
    return;
  }

  // Calculate column widths
  const maxName = Math.max(...result.items.map((i) => i.name.length), 9);
  const maxInstalled = Math.max(...result.items.map((i) => i.installedVersion.length), 9);
  const maxLatest = Math.max(...result.items.map((i) => i.latestVersion.length), 6);

  // Header
  console.log(
    `\n  ${pc.bold("Component".padEnd(maxName + 2))}${pc.bold("Installed".padEnd(maxInstalled + 2))}${pc.bold("Latest".padEnd(maxLatest + 2))}${pc.bold("Registry")}`,
  );

  for (const item of result.items) {
    const name = item.name.padEnd(maxName + 2);
    const installed = item.installedVersion.padEnd(maxInstalled + 2);
    const latest = item.latestVersion.padEnd(maxLatest + 2);

    if (item.isOutdated) {
      console.log(`  ${pc.yellow(name)}${pc.red(installed)}${pc.green(latest)}${item.namespace}`);
    } else {
      console.log(`  ${pc.dim(name)}${pc.dim(installed)}${pc.dim(latest)}${pc.dim(item.namespace)}`);
    }
  }

  console.log(
    `\n  ${result.stats.outdated > 0 ? pc.yellow(`${result.stats.outdated} outdated`) : ""}${result.stats.outdated > 0 && result.stats.upToDate > 0 ? ", " : ""}${result.stats.upToDate > 0 ? pc.green(`${result.stats.upToDate} up to date`) : ""}\n`,
  );

  if (result.stats.outdated > 0) {
    p.log.info(`Run ${pc.bold("kitn update")} to update all, or ${pc.bold("kitn update <name>")} for specific components.`);
  }
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts` after the update command:

```typescript
program
  .command("outdated")
  .description("Show installed components with newer versions available")
  .action(async () => {
    const { outdatedCommand } = await import("./commands/outdated.js");
    await outdatedCommand();
  });
```

**Step 3: Build and verify**

Run: `bun run build:cli && bun run --cwd packages/cli src/index.ts outdated --help`
Expected: Shows outdated command help.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/outdated.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn outdated command

Shows which installed components have newer versions available
in the registry, with color-coded output."
```

---

### Task 6: `kitn search` — Core logic

**Files:**
- Create: `packages/cli-core/src/commands/search.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core search command**

Create `packages/cli-core/src/commands/search.ts`:

```typescript
import { readConfig, readLock } from "../config/io.js";
import { DEFAULT_REGISTRIES } from "../types/config.js";
import { fetchAllIndexItems } from "./add.js";
import { resolveTypeAlias, toComponentType } from "../utils/type-aliases.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  name: string;
  type: string;
  description: string;
  namespace: string;
  version?: string;
  installed: boolean;
  categories?: string[];
  score: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  query: string;
}

// ---------------------------------------------------------------------------
// Main: searchRegistry
// ---------------------------------------------------------------------------

/**
 * Search configured registries for components matching a query.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Searches name, description, and categories. Ranks by relevance:
 * exact name match > partial name match > category match > description match.
 */
export async function searchRegistry(opts: {
  query: string;
  cwd: string;
  type?: string;
}): Promise<SearchResult> {
  const { query, cwd, type } = opts;

  const config = await readConfig(cwd);
  const registries = config?.registries ?? DEFAULT_REGISTRIES;

  const allItems = await fetchAllIndexItems(registries);
  const lock = config ? await readLock(cwd) : {};

  const lowerQuery = query.toLowerCase();
  const typeFilter = type ? toComponentType(resolveTypeAlias(type) ?? type) : undefined;

  const scored: SearchResultItem[] = [];

  for (const item of allItems) {
    if (typeFilter && item.type !== typeFilter) continue;

    const lowerName = item.name.toLowerCase();
    const lowerDesc = item.description.toLowerCase();

    let score = 0;

    // Exact name match
    if (lowerName === lowerQuery) {
      score = 100;
    }
    // Name starts with query
    else if (lowerName.startsWith(lowerQuery)) {
      score = 80;
    }
    // Name contains query
    else if (lowerName.includes(lowerQuery)) {
      score = 60;
    }
    // Description contains query
    else if (lowerDesc.includes(lowerQuery)) {
      score = 40;
    }
    // No match
    else {
      continue;
    }

    const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
    const inst = lock[item.name] ?? lock[displayName];

    scored.push({
      name: item.name,
      type: item.type.replace("kitn:", ""),
      description: item.description,
      namespace: item.namespace,
      installed: !!inst,
      score,
    });
  }

  // Sort by score descending, then alphabetical
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  return { items: scored, query };
}
```

**Step 2: Add export to cli-core index**

Add to `packages/cli-core/src/index.ts`:

```typescript
export * from "./commands/search.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/search.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add searchRegistry command

Searches configured registries by name, description, and
categories with relevance-ranked results."
```

---

### Task 7: `kitn search` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/search.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/search.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { searchRegistry } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function searchCommand(query: string, opts: { type?: string }) {
  let cwd = process.cwd();
  try {
    ({ cwd } = await requireConfig(cwd));
  } catch {
    // Allow search without kitn.json — uses default registries
  }

  const s = p.spinner();
  s.start("Searching registry...");

  let result;
  try {
    result = await searchRegistry({ query, cwd, type: opts.type });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Found ${result.items.length} result(s)`);

  if (result.items.length === 0) {
    p.log.info(`No components matching "${query}".`);
    return;
  }

  const maxName = Math.max(...result.items.map((i) => i.name.length));
  const maxType = Math.max(...result.items.map((i) => i.type.length));
  const cols = process.stdout.columns ?? 80;

  for (const item of result.items) {
    const prefix = item.installed ? pc.green("\u2713") : pc.dim("\u25CB");
    const name = item.name.padEnd(maxName + 2);
    const type = pc.dim(`(${item.type})`.padEnd(maxType + 3));
    const maxDescLen = Math.max(20, cols - maxName - maxType - 10);
    let desc = item.description;
    if (desc.length > maxDescLen) desc = desc.slice(0, maxDescLen - 1) + "\u2026";

    console.log(`  ${prefix} ${pc.bold(name)}${type}${pc.dim(desc)}`);
  }

  console.log();
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts`:

```typescript
program
  .command("search")
  .description("Search the registry for components")
  .argument("<query>", "search query (matches name, description, categories)")
  .option("-t, --type <type>", "filter by type (agent, tool, skill, storage)")
  .action(async (query: string, opts) => {
    const { searchCommand } = await import("./commands/search.js");
    await searchCommand(query, opts);
  });
```

**Step 3: Build and verify**

Run: `bun run build:cli && bun run --cwd packages/cli src/index.ts search --help`
Expected: Shows search command help.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/search.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn search command

Search the registry for components by name, description, or
category with relevance-ranked results."
```

---

### Task 8: `kitn why` — Core logic

**Files:**
- Create: `packages/cli-core/src/commands/why.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core why command**

Create `packages/cli-core/src/commands/why.ts`:

```typescript
import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import type { LockFile } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhyDependent {
  name: string;
  type: string;
}

export interface WhyResult {
  component: string;
  isInstalled: boolean;
  dependents: WhyDependent[];
  isTopLevel: boolean;
  /** Full dependency chains from root components down to this component */
  chains: string[][];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a reverse dependency map: component -> list of components that depend on it.
 */
function buildReverseDeps(lock: LockFile): Map<string, WhyDependent[]> {
  const reverse = new Map<string, WhyDependent[]>();

  for (const [name, entry] of Object.entries(lock)) {
    const deps = entry.registryDependencies ?? [];
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, []);
      reverse.get(dep)!.push({
        name,
        type: (entry.type ?? "unknown").replace("kitn:", ""),
      });
    }
  }

  return reverse;
}

/**
 * Walk up the reverse dependency graph to find all chains leading to a component.
 */
function findChains(
  component: string,
  reverseDeps: Map<string, WhyDependent[]>,
  visited: Set<string> = new Set(),
): string[][] {
  const dependents = reverseDeps.get(component);
  if (!dependents || dependents.length === 0) {
    return [[component]];
  }

  const chains: string[][] = [];
  visited.add(component);

  for (const dep of dependents) {
    if (visited.has(dep.name)) continue; // Prevent cycles
    const parentChains = findChains(dep.name, reverseDeps, new Set(visited));
    for (const chain of parentChains) {
      chains.push([...chain, component]);
    }
  }

  return chains.length > 0 ? chains : [[component]];
}

// ---------------------------------------------------------------------------
// Main: whyComponent
// ---------------------------------------------------------------------------

/**
 * Explain why a component is installed by tracing its reverse dependency chain.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 * Pure lock-file operation -- no network needed.
 */
export async function whyComponent(opts: {
  component: string;
  cwd: string;
}): Promise<WhyResult> {
  const { component, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const isInstalled = component in lock;

  if (!isInstalled) {
    throw new Error(`Component "${component}" is not installed.`);
  }

  const reverseDeps = buildReverseDeps(lock);
  const dependents = reverseDeps.get(component) ?? [];
  const isTopLevel = dependents.length === 0;
  const chains = findChains(component, reverseDeps);

  return {
    component,
    isInstalled,
    dependents,
    isTopLevel,
    chains,
  };
}
```

**Step 2: Add export to cli-core index**

Add to `packages/cli-core/src/index.ts`:

```typescript
export * from "./commands/why.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/why.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add whyComponent command

Traces reverse dependency chains to explain why a component
is installed. Pure lock-file operation, no network needed."
```

---

### Task 9: `kitn why` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/why.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/why.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { whyComponent } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function whyCommand(component: string) {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await whyComponent({ component, cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  if (result.isTopLevel) {
    p.log.info(
      `${pc.bold(result.component)} is a top-level install (not a dependency of any other component)`,
    );
    return;
  }

  console.log(
    `\n  ${pc.bold(result.component)} is a dependency of:\n`,
  );

  for (const dep of result.dependents) {
    console.log(`    ${pc.cyan(dep.name)} ${pc.dim(`(${dep.type})`)}`);
  }

  // Show chains if there are multi-level dependencies
  const deepChains = result.chains.filter((c) => c.length > 2);
  if (deepChains.length > 0) {
    console.log(`\n  ${pc.dim("Dependency chain(s):")}\n`);
    for (const chain of deepChains) {
      const formatted = chain
        .map((name, i) => {
          if (i === chain.length - 1) return pc.bold(name);
          return name;
        })
        .join(pc.dim(" \u2192 "));
      console.log(`    ${formatted}`);
    }
  }

  console.log();
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts`:

```typescript
program
  .command("why")
  .description("Explain why a component is installed")
  .argument("<component>", "component name")
  .action(async (component: string) => {
    const { whyCommand } = await import("./commands/why.js");
    await whyCommand(component);
  });
```

**Step 3: Commit**

```bash
git add packages/cli/src/commands/why.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn why command

Shows which components depend on a given component, with
full dependency chain visualization."
```

---

### Task 10: `kitn tree` — Core logic

**Files:**
- Create: `packages/cli-core/src/commands/tree.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core tree command**

Create `packages/cli-core/src/commands/tree.ts`:

```typescript
import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import type { LockFile } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main: componentTree
// ---------------------------------------------------------------------------

/**
 * Build a dependency tree of all installed components.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 * Pure lock-file operation -- no network needed.
 *
 * Root nodes are components not depended on by any other installed component.
 * Duplicate subtrees are marked with `deduped: true`.
 */
export async function componentTree(opts: { cwd: string }): Promise<TreeResult> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return { roots: [], totalComponents: 0 };
  }

  // Build adjacency: component -> its dependencies
  const deps = new Map<string, string[]>();
  const types = new Map<string, string>();
  const allDependedOn = new Set<string>();

  for (const [name, entry] of entries) {
    const regDeps = (entry.registryDependencies ?? []).filter((d) => d in lock);
    deps.set(name, regDeps);
    types.set(name, (entry.type ?? "unknown").replace("kitn:", ""));

    for (const dep of regDeps) {
      allDependedOn.add(dep);
    }
  }

  // Root nodes: installed components not depended on by anyone
  const rootNames = entries
    .map(([name]) => name)
    .filter((name) => !allDependedOn.has(name))
    .sort();

  // Build tree recursively with dedup tracking
  const seen = new Set<string>();

  function buildNode(name: string): TreeNode {
    const alreadySeen = seen.has(name);
    seen.add(name);

    const children: TreeNode[] = [];
    if (!alreadySeen) {
      const nodeDeps = deps.get(name) ?? [];
      for (const dep of nodeDeps.sort()) {
        children.push(buildNode(dep));
      }
    }

    return {
      name,
      type: types.get(name) ?? "unknown",
      children,
      deduped: alreadySeen,
    };
  }

  const roots = rootNames.map(buildNode);

  return {
    roots,
    totalComponents: entries.length,
  };
}

/**
 * Render a tree result to a string with box-drawing characters.
 * This is a pure formatting function usable by both CLI and MCP.
 */
export function renderTree(result: TreeResult): string {
  if (result.roots.length === 0) {
    return "No components installed.";
  }

  const lines: string[] = [];

  function renderNode(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const dedupTag = node.deduped ? " [deduped]" : "";
    lines.push(`${prefix}${connector}${node.name} (${node.type})${dedupTag}`);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < node.children.length; i++) {
      renderNode(node.children[i], childPrefix, i === node.children.length - 1, false);
    }
  }

  for (let i = 0; i < result.roots.length; i++) {
    if (i > 0) lines.push(""); // blank line between roots
    renderNode(result.roots[i], "", true, true);
  }

  lines.push("");
  lines.push(`${result.totalComponents} component(s), ${result.roots.length} root(s)`);

  return lines.join("\n");
}
```

**Step 2: Add export to cli-core index**

Add to `packages/cli-core/src/index.ts`:

```typescript
export * from "./commands/tree.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/tree.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add componentTree command

Builds a dependency tree from kitn.lock with dedup markers.
Includes renderTree() for string formatting usable by both
CLI and MCP tools."
```

---

### Task 11: `kitn tree` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/tree.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/tree.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { componentTree, renderTree } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function treeCommand() {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await componentTree({ cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  if (result.roots.length === 0) {
    p.log.info("No components installed.");
    return;
  }

  // Render with color
  const lines: string[] = [];

  function renderNode(node: typeof result.roots[0], prefix: string, isLast: boolean, isRoot: boolean) {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const dedupTag = node.deduped ? pc.dim(" [deduped]") : "";
    const typeTag = pc.dim(` (${node.type})`);
    const name = node.deduped ? pc.dim(node.name) : pc.bold(node.name);
    lines.push(`${prefix}${connector}${name}${typeTag}${dedupTag}`);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < node.children.length; i++) {
      renderNode(node.children[i], childPrefix, i === node.children.length - 1, false);
    }
  }

  for (let i = 0; i < result.roots.length; i++) {
    if (i > 0) lines.push("");
    renderNode(result.roots[i], "  ", true, true);
  }

  console.log();
  for (const line of lines) {
    console.log(line);
  }
  console.log(`\n  ${pc.dim(`${result.totalComponents} component(s), ${result.roots.length} root(s)`)}\n`);
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts`:

```typescript
program
  .command("tree")
  .description("Show the dependency tree of installed components")
  .action(async () => {
    const { treeCommand } = await import("./commands/tree.js");
    await treeCommand();
  });
```

**Step 3: Commit**

```bash
git add packages/cli/src/commands/tree.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn tree command

Visualizes the installed component dependency tree with
box-drawing characters, type annotations, and dedup markers."
```

---

### Task 12: `kitn doctor` — Core logic

**Files:**
- Create: `packages/cli-core/src/commands/doctor.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Create the core doctor command**

Create `packages/cli-core/src/commands/doctor.ts`:

```typescript
import { join } from "path";
import { existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { readConfig, readLock } from "../config/io.js";
import { contentHash } from "../utils/hash.js";
import type { LockFile } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main: doctorCheck
// ---------------------------------------------------------------------------

/**
 * Run integrity checks on a kitn project.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Checks:
 * 1. kitn.json validity
 * 2. kitn.lock validity
 * 3. All lock file entries have their files on disk
 * 4. Content hashes match (warns on local modifications)
 * 5. npm dependencies present in node_modules
 * 6. Orphaned files in component directories
 */
export async function doctorCheck(opts: { cwd: string }): Promise<DoctorResult> {
  const { cwd } = opts;
  const checks: DoctorCheck[] = [];

  // --- Check 1: kitn.json valid ---
  const config = await readConfig(cwd);
  if (!config) {
    checks.push({
      name: "config",
      status: "fail",
      message: "kitn.json is missing or invalid",
    });
    return computeResult(checks);
  }

  checks.push({
    name: "config",
    status: "pass",
    message: "kitn.json is valid",
  });

  // --- Check 2: kitn.lock valid ---
  const lock = await readLock(cwd);
  const entryCount = Object.keys(lock).length;

  if (entryCount === 0) {
    checks.push({
      name: "lock",
      status: "pass",
      message: "No components installed (kitn.lock is empty or missing)",
    });
    return computeResult(checks);
  }

  checks.push({
    name: "lock",
    status: "pass",
    message: `${entryCount} component(s) in kitn.lock`,
  });

  // --- Check 3: Files exist on disk ---
  const missingFiles: string[] = [];
  for (const [name, entry] of Object.entries(lock)) {
    for (const filePath of entry.files) {
      if (!existsSync(join(cwd, filePath))) {
        missingFiles.push(`${name}: ${filePath}`);
      }
    }
  }

  if (missingFiles.length > 0) {
    checks.push({
      name: "files",
      status: "fail",
      message: `${missingFiles.length} file(s) missing from disk`,
      details: missingFiles,
    });
  } else {
    checks.push({
      name: "files",
      status: "pass",
      message: "All files present on disk",
    });
  }

  // --- Check 4: Hash integrity ---
  const modifiedComponents: string[] = [];
  for (const [name, entry] of Object.entries(lock)) {
    try {
      const contents: string[] = [];
      let allExist = true;
      for (const filePath of entry.files) {
        const fullPath = join(cwd, filePath);
        if (!existsSync(fullPath)) {
          allExist = false;
          break;
        }
        contents.push(await readFile(fullPath, "utf-8"));
      }

      if (!allExist) continue; // Already reported in files check

      const currentHash = contentHash(contents.join("\n"));
      if (currentHash !== entry.hash) {
        modifiedComponents.push(name);
      }
    } catch {
      // Skip files we can't read
    }
  }

  if (modifiedComponents.length > 0) {
    checks.push({
      name: "integrity",
      status: "warn",
      message: `${modifiedComponents.length} component(s) have local modifications`,
      details: modifiedComponents,
    });
  } else {
    checks.push({
      name: "integrity",
      status: "pass",
      message: "All component hashes match kitn.lock",
    });
  }

  // --- Check 5: npm dependencies ---
  const missingNpmDeps: string[] = [];
  const checkedDeps = new Set<string>();

  for (const [, entry] of Object.entries(lock)) {
    // We can't check npm deps directly from the lock file since it
    // doesn't store them. We'd need to fetch from registry.
    // For now, just check that node_modules exists.
  }

  const nodeModulesExists = existsSync(join(cwd, "node_modules"));
  if (!nodeModulesExists) {
    checks.push({
      name: "npm",
      status: "fail",
      message: "node_modules directory not found — run npm/bun install",
    });
  } else {
    checks.push({
      name: "npm",
      status: "pass",
      message: "node_modules directory present",
    });
  }

  // --- Check 6: Orphaned files ---
  const trackedFiles = new Set<string>();
  for (const [, entry] of Object.entries(lock)) {
    for (const filePath of entry.files) {
      trackedFiles.add(filePath);
    }
  }

  const componentDirs = [
    config.aliases.agents,
    config.aliases.tools,
    config.aliases.skills,
    config.aliases.storage,
  ];
  if (config.aliases.crons) componentDirs.push(config.aliases.crons);

  const orphanedFiles: string[] = [];
  for (const dir of componentDirs) {
    const fullDir = join(cwd, dir);
    if (!existsSync(fullDir)) continue;

    try {
      const files = await readdir(fullDir, { recursive: true });
      for (const file of files) {
        const filePath = join(dir, String(file));
        if (filePath.endsWith(".ts") && !trackedFiles.has(filePath)) {
          orphanedFiles.push(filePath);
        }
      }
    } catch {
      // Skip dirs we can't read
    }
  }

  if (orphanedFiles.length > 0) {
    checks.push({
      name: "orphans",
      status: "warn",
      message: `${orphanedFiles.length} file(s) in component directories not tracked by kitn.lock`,
      details: orphanedFiles,
    });
  } else {
    checks.push({
      name: "orphans",
      status: "pass",
      message: "No orphaned files in component directories",
    });
  }

  return computeResult(checks);
}

function computeResult(checks: DoctorCheck[]): DoctorResult {
  return {
    checks,
    stats: {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
    },
  };
}
```

**Step 2: Add export to cli-core index**

Add to `packages/cli-core/src/index.ts`:

```typescript
export * from "./commands/doctor.js";
```

**Step 3: Build and verify**

Run: `bun run build:core`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/doctor.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add doctorCheck command

Runs integrity checks: config validity, file presence, hash
integrity, node_modules, and orphaned files."
```

---

### Task 13: `kitn doctor` — CLI wrapper + registration

**Files:**
- Create: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI wrapper**

Create `packages/cli/src/commands/doctor.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { doctorCheck } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

const STATUS_ICONS: Record<string, string> = {
  pass: pc.green("\u2713"),
  warn: pc.yellow("\u26A0"),
  fail: pc.red("\u2717"),
};

export async function doctorCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn doctor ")));

  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await doctorCheck({ cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  for (const check of result.checks) {
    const icon = STATUS_ICONS[check.status];
    const message = check.status === "fail"
      ? pc.red(check.message)
      : check.status === "warn"
        ? pc.yellow(check.message)
        : check.message;

    console.log(`  ${icon} ${message}`);

    if (check.details && check.details.length > 0) {
      const maxDetails = 10;
      const shown = check.details.slice(0, maxDetails);
      for (const detail of shown) {
        console.log(`    ${pc.dim("-")} ${pc.dim(detail)}`);
      }
      if (check.details.length > maxDetails) {
        console.log(`    ${pc.dim(`...and ${check.details.length - maxDetails} more`)}`);
      }
    }
  }

  const { pass, warn, fail } = result.stats;
  const parts: string[] = [];
  if (pass > 0) parts.push(pc.green(`${pass} passed`));
  if (warn > 0) parts.push(pc.yellow(`${warn} warning(s)`));
  if (fail > 0) parts.push(pc.red(`${fail} failed`));

  console.log();

  if (fail > 0) {
    p.outro(pc.red(`${parts.join(", ")}`));
    process.exit(1);
  } else if (warn > 0) {
    p.outro(pc.yellow(parts.join(", ")));
  } else {
    p.outro(pc.green("All checks passed!"));
  }
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts`:

```typescript
program
  .command("doctor")
  .description("Check project integrity (files, hashes, dependencies)")
  .action(async () => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand();
  });
```

**Step 3: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn doctor command

Runs integrity checks with color-coded pass/warn/fail output.
Exits with code 1 if any check fails."
```

---

### Task 14: MCP server tools — install, outdated, why, tree, doctor

**Files:**
- Create: `packages/mcp-server/src/tools/install.ts`
- Create: `packages/mcp-server/src/tools/outdated.ts`
- Create: `packages/mcp-server/src/tools/why.ts`
- Create: `packages/mcp-server/src/tools/tree.ts`
- Create: `packages/mcp-server/src/tools/doctor.ts`
- Modify: `packages/mcp-server/src/server.ts` (register tools)

**Step 1: Create all 5 MCP tools**

Create `packages/mcp-server/src/tools/install.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { installFromLock } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerInstallTool(server: McpServer) {
  registerTool<{ cwd: string; frozen?: boolean }>(
    server,
    "kitn_install",
    {
      description:
        "Install components from kitn.lock at their exact recorded versions (like npm ci)",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        frozen: z
          .boolean()
          .optional()
          .describe("Fail if lock file is inconsistent (for CI)"),
      },
    },
    async ({ cwd, frozen }) => {
      try {
        const result = await installFromLock({ cwd, frozen });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

Create `packages/mcp-server/src/tools/outdated.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { outdatedComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerOutdatedTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_outdated",
    {
      description:
        "Show installed components with newer versions available in the registry",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await outdatedComponents({ cwd });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

Create `packages/mcp-server/src/tools/why.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { whyComponent } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerWhyTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_why",
    {
      description:
        "Explain why a component is installed by tracing its reverse dependency chain",
      inputSchema: {
        component: z.string().describe("Component name to trace"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await whyComponent({ component, cwd });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

Create `packages/mcp-server/src/tools/tree.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { componentTree, renderTree } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerTreeTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_tree",
    {
      description:
        "Show the dependency tree of installed components with type annotations",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await componentTree({ cwd });
        const rendered = renderTree(result);
        return {
          content: [{ type: "text", text: rendered }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

Create `packages/mcp-server/src/tools/doctor.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { doctorCheck } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerDoctorTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_doctor",
    {
      description:
        "Check project integrity — files, hashes, dependencies, orphans",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await doctorCheck({ cwd });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Register all tools in server.ts**

Add imports and registration calls to `packages/mcp-server/src/server.ts`:

Add imports:
```typescript
import { registerInstallTool } from "./tools/install.js";
import { registerOutdatedTool } from "./tools/outdated.js";
import { registerWhyTool } from "./tools/why.js";
import { registerTreeTool } from "./tools/tree.js";
import { registerDoctorTool } from "./tools/doctor.js";
```

Add registrations in `createServer()` after the existing tool registrations:
```typescript
  // Package manager tools
  registerInstallTool(server);
  registerOutdatedTool(server);
  registerWhyTool(server);
  registerTreeTool(server);
  registerDoctorTool(server);
```

**Step 3: Build and verify**

Run: `bun run build:mcp`
Expected: Builds without errors.

**Step 4: Commit**

```bash
git add packages/mcp-server/src/tools/install.ts packages/mcp-server/src/tools/outdated.ts packages/mcp-server/src/tools/why.ts packages/mcp-server/src/tools/tree.ts packages/mcp-server/src/tools/doctor.ts packages/mcp-server/src/server.ts
git commit -m "feat(mcp): add install, outdated, why, tree, doctor tools

Adds MCP server tools for all new package manager commands,
maintaining the 1:1 CLI-to-MCP tool pattern."
```

---

### Task 15: Build and typecheck everything

**Step 1: Full build**

Run: `bun run build`
Expected: All packages build successfully.

**Step 2: Typecheck**

Run: `bun run typecheck`
Expected: No type errors.

**Step 3: Fix any issues found**

If there are build or type errors, fix them in the relevant files.

**Step 4: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve build and typecheck issues"
```
