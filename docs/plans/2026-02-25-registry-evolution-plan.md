# Registry Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add versioning, changelog, namespacing, and a `kitn info` command to the registry, migrate the registry to its own repo, and rename `_installed` to `installed`.

**Architecture:** Extend registry schemas with version/changelog/namespace fields, create a `parseComponentRef` utility for `@namespace/name@version` parsing, update all CLI commands to use it, add `kitn info` command, build versioned output files, and migrate registry contents to `kitn-ai/registry`.

**Tech Stack:** TypeScript, Zod schemas, Commander.js, @clack/prompts, Bun test runner, gh CLI for repo operations

---

### Task 1: Rename `_installed` to `installed` throughout codebase

**Files:**
- Modify: `packages/cli/src/utils/config.ts`
- Modify: `packages/cli/src/commands/add.ts`
- Modify: `packages/cli/src/commands/list.ts`
- Modify: `packages/cli/src/commands/remove.ts`
- Modify: `packages/cli/src/commands/update.ts`
- Modify: `packages/cli/src/commands/diff.ts`
- Modify: `packages/cli/test/schema.test.ts`
- Modify: `registry/src/schema.ts`

**Step 1: Update config schema**

In `packages/cli/src/utils/config.ts`, rename the field in the Zod schema:
```ts
// Change:
_installed: z.record(z.string(), installedComponentSchema).optional(),
// To:
installed: z.record(z.string(), installedComponentSchema).optional(),
```

**Step 2: Find and replace all `_installed` references**

In all CLI command files, replace:
- `config._installed` → `config.installed`
- `delete config._installed` → `delete config.installed`

Do the same in `registry/src/schema.ts`.

**Step 3: Update tests**

In `packages/cli/test/schema.test.ts`, update any test configs that use `_installed` to use `installed`.

**Step 4: Verify**

Run: `bun run --cwd packages/cli build && bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename _installed to installed in config schema"
```

---

### Task 2: Add changelog and updatedAt to registry schemas

**Files:**
- Modify: `packages/cli/src/registry/schema.ts`
- Modify: `registry/src/schema.ts`
- Modify: `packages/cli/test/schema.test.ts`

**Step 1: Write failing tests**

Add to `packages/cli/test/schema.test.ts`:
```ts
describe("changelog schema", () => {
  test("accepts changelog on registry item", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      files: [{ path: "agents/test.ts", content: "", type: "kitn:agent" }],
      version: "1.1.0",
      updatedAt: "2026-02-25T16:30:00Z",
      changelog: [
        { version: "1.1.0", date: "2026-02-25", type: "feature", note: "Added streaming" },
        { version: "1.0.0", date: "2026-02-15", type: "initial", note: "Initial release" },
      ],
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("changelog is optional", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      files: [{ path: "agents/test.ts", content: "", type: "kitn:agent" }],
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("registry index includes versions array and updatedAt", () => {
    const { registryIndexItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      version: "1.1.0",
      versions: ["1.1.0", "1.0.0"],
      updatedAt: "2026-02-25T16:30:00Z",
    };
    expect(() => registryIndexItemSchema.parse(item)).not.toThrow();
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `bun test packages/cli/test/schema.test.ts`

**Step 3: Update CLI schema**

In `packages/cli/src/registry/schema.ts`:

Add changelog entry schema:
```ts
export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  type: z.enum(["feature", "fix", "breaking", "initial"]),
  note: z.string(),
});
```

Add to `registryItemSchema`:
```ts
updatedAt: z.string().optional(),
changelog: z.array(changelogEntrySchema).optional(),
```

Add to `registryIndexItemSchema`:
```ts
versions: z.array(z.string()).optional(),
updatedAt: z.string().optional(),
```

**Step 4: Mirror in registry schema**

Apply same changes to `registry/src/schema.ts`.

**Step 5: Run tests**

Run: `bun test && bun run --cwd packages/cli build`
Expected: All pass

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add changelog, updatedAt, and versions to registry schemas"
```

---

### Task 3: Add `registry` field to installed tracking and update config schema

**Files:**
- Modify: `packages/cli/src/utils/config.ts`
- Modify: `packages/cli/src/commands/add.ts`
- Modify: `packages/cli/test/schema.test.ts`
- Modify: `registry/src/schema.ts`

**Step 1: Write failing test**

Add to `packages/cli/test/schema.test.ts`:
```ts
test("installed entry accepts registry field", () => {
  const { configSchema } = require("../src/utils/config.js");
  const config = {
    runtime: "bun",
    framework: "hono",
    aliases: { base: "src/ai", agents: "src/ai/agents", tools: "src/ai/tools", skills: "src/ai/skills", storage: "src/ai/storage" },
    registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    installed: {
      "weather-agent": {
        registry: "@kitn",
        version: "1.0.0",
        installedAt: "2026-02-25T00:00:00Z",
        files: ["src/ai/agents/weather-agent.ts"],
        hash: "abc12345",
      },
    },
  };
  expect(() => configSchema.parse(config)).not.toThrow();
});
```

**Step 2: Update installed component schema**

In `packages/cli/src/utils/config.ts`, add `registry` to the installed schema:
```ts
const installedComponentSchema = z.object({
  registry: z.string().optional(),
  version: z.string(),
  installedAt: z.string(),
  files: z.array(z.string()),
  hash: z.string(),
});
```

Mirror in `registry/src/schema.ts`.

**Step 3: Update add command to store registry**

In `packages/cli/src/commands/add.ts`, when tracking an installed component, include the registry namespace (default `"@kitn"` for now — namespace parsing comes in Task 4).

**Step 4: Run tests**

Run: `bun test && bun run --cwd packages/cli build`

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add registry field to installed component tracking"
```

---

### Task 4: Create `parseComponentRef` utility

**Files:**
- Create: `packages/cli/src/utils/parse-ref.ts`
- Create: `packages/cli/test/parse-ref.test.ts`

**Step 1: Write failing tests**

Create `packages/cli/test/parse-ref.test.ts`:
```ts
import { describe, test, expect } from "bun:test";
import { parseComponentRef } from "../src/utils/parse-ref.js";

describe("parseComponentRef", () => {
  test("plain name defaults to @kitn namespace, no version", () => {
    const ref = parseComponentRef("weather-agent");
    expect(ref).toEqual({ namespace: "@kitn", name: "weather-agent", version: undefined });
  });

  test("name with version", () => {
    const ref = parseComponentRef("weather-agent@1.0.0");
    expect(ref).toEqual({ namespace: "@kitn", name: "weather-agent", version: "1.0.0" });
  });

  test("namespaced name", () => {
    const ref = parseComponentRef("@acme/weather-agent");
    expect(ref).toEqual({ namespace: "@acme", name: "weather-agent", version: undefined });
  });

  test("namespaced name with version", () => {
    const ref = parseComponentRef("@acme/weather-agent@2.0.0");
    expect(ref).toEqual({ namespace: "@acme", name: "weather-agent", version: "2.0.0" });
  });

  test("semver with pre-release", () => {
    const ref = parseComponentRef("agent@1.0.0-beta.1");
    expect(ref).toEqual({ namespace: "@kitn", name: "agent", version: "1.0.0-beta.1" });
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `bun test packages/cli/test/parse-ref.test.ts`

**Step 3: Implement**

Create `packages/cli/src/utils/parse-ref.ts`:
```ts
export interface ComponentRef {
  namespace: string;
  name: string;
  version: string | undefined;
}

export function parseComponentRef(input: string): ComponentRef {
  let namespace = "@kitn";
  let rest = input;

  // Parse @namespace/name
  if (rest.startsWith("@")) {
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(`Invalid component reference: ${input}. Expected @namespace/name`);
    }
    namespace = rest.slice(0, slashIdx);
    rest = rest.slice(slashIdx + 1);
  }

  // Parse name@version
  const atIdx = rest.indexOf("@");
  if (atIdx === -1) {
    return { namespace, name: rest, version: undefined };
  }

  return {
    namespace,
    name: rest.slice(0, atIdx),
    version: rest.slice(atIdx + 1),
  };
}
```

**Step 4: Run tests**

Run: `bun test packages/cli/test/parse-ref.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add parseComponentRef utility for @namespace/name@version parsing"
```

---

### Task 5: Update fetcher for namespace and version support

**Files:**
- Modify: `packages/cli/src/registry/fetcher.ts`
- Create: `packages/cli/test/fetcher.test.ts`

**Step 1: Write failing tests**

Create `packages/cli/test/fetcher.test.ts`:
```ts
import { describe, test, expect } from "bun:test";
import { RegistryFetcher } from "../src/registry/fetcher.js";

const registries = {
  "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
  "@acme": "https://acme.example.com/r/{type}/{name}.json",
};

describe("RegistryFetcher", () => {
  test("resolves URL for default namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@kitn");
    expect(url).toBe("https://kitn.example.com/r/agents/weather-agent.json");
  });

  test("resolves URL with version", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@kitn", "1.0.0");
    expect(url).toBe("https://kitn.example.com/r/agents/weather-agent@1.0.0.json");
  });

  test("resolves URL for third-party namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@acme");
    expect(url).toBe("https://acme.example.com/r/agents/weather-agent.json");
  });

  test("throws for unknown namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    expect(() => fetcher.resolveUrl("test", "agents", "@unknown")).toThrow("No registry configured for @unknown");
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `bun test packages/cli/test/fetcher.test.ts`

**Step 3: Update fetcher**

Update `packages/cli/src/registry/fetcher.ts`:
- `resolveUrl` takes optional `namespace` and `version` parameters
- When version is provided, append `@version` to the name before URL substitution
- Look up registry URL by namespace instead of hardcoding `"@kitn"`
- `fetchItem` and `fetchIndex` take optional namespace

```ts
type TypeDir = "agents" | "tools" | "skills" | "storage" | "package";

export class RegistryFetcher {
  private registries: Record<string, string>;
  private cache = new Map<string, Promise<RegistryItem>>();
  private fetchFn: FetchFn;

  constructor(registries: Record<string, string>, fetchFn?: FetchFn) {
    this.registries = registries;
    this.fetchFn = fetchFn ?? this.defaultFetch;
  }

  resolveUrl(name: string, typeDir: TypeDir, namespace = "@kitn", version?: string): string {
    const template = this.registries[namespace];
    if (!template) throw new Error(`No registry configured for ${namespace}`);
    const fileName = version ? `${name}@${version}` : name;
    return template.replace("{name}", fileName).replace("{type}", typeDir);
  }

  async fetchItem(name: string, typeDir: TypeDir, namespace = "@kitn", version?: string): Promise<RegistryItem> {
    const url = this.resolveUrl(name, typeDir, namespace, version);
    if (!this.cache.has(url)) {
      this.cache.set(url, this.fetchFn(url));
    }
    return this.cache.get(url)!;
  }

  async fetchIndex(namespace = "@kitn"): Promise<RegistryIndex> {
    const template = this.registries[namespace];
    if (!template) throw new Error(`No registry configured for ${namespace}`);
    const baseUrl = template.replace("{type}/{name}.json", "registry.json");
    const res = await fetch(baseUrl);
    if (!res.ok) throw new Error(`Failed to fetch registry index: ${res.statusText}`);
    return res.json();
  }

  private async defaultFetch(url: string): Promise<RegistryItem> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    return res.json();
  }
}
```

**Step 4: Run tests**

Run: `bun test packages/cli/test/fetcher.test.ts && bun test`

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: fetcher supports namespace and version in URL resolution"
```

---

### Task 6: Wire parseComponentRef into `kitn add`

**Files:**
- Modify: `packages/cli/src/commands/add.ts`

**Step 1: Update add command**

Import `parseComponentRef` and use it to parse component references. The current `resolvedComponents` logic (routes → framework) stays, but now each component also goes through `parseComponentRef`:

```ts
import { parseComponentRef } from "../utils/parse-ref.js";

// After the routes resolution, parse refs:
const refs = resolvedComponents.map(parseComponentRef);
```

Update the resolver callback to pass namespace and version to the fetcher:

```ts
resolved = await resolveDependencies(refs.map(r => r.name), async (name) => {
  // Find the ref for this name to get namespace/version, default to @kitn/latest for deps
  const ref = refs.find(r => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
  const index = await fetcher.fetchIndex(ref.namespace);
  const indexItem = index.items.find((i) => i.name === name);
  if (!indexItem) throw new Error(`Component '${name}' not found in ${ref.namespace} registry`);
  const dir = typeToDir[indexItem.type];
  return fetcher.fetchItem(name, dir as any, ref.namespace, ref.version);
});
```

Update the `installed` tracking to include `registry`:

```ts
installed[item.name] = {
  registry: "@kitn", // TODO: pass through from ref
  version: item.version ?? "1.0.0",
  installedAt: new Date().toISOString(),
  files: [...],
  hash: contentHash(allContent),
};
```

For third-party components (namespace !== "@kitn"), use the full `@namespace/name` as the installed key.

**Step 2: Build and test**

Run: `bun run --cwd packages/cli build && bun test`

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: kitn add parses @namespace/name@version references"
```

---

### Task 7: Create `kitn info` command

**Files:**
- Create: `packages/cli/src/commands/info.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement info command**

Create `packages/cli/src/commands/info.ts`:

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { typeToDir } from "../registry/schema.js";

export async function infoCommand(componentInput: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const ref = parseComponentRef(componentInput);
  const fetcher = new RegistryFetcher(config.registries);

  const s = p.spinner();
  s.start("Fetching component info...");

  // Get index for version list
  let index;
  try {
    index = await fetcher.fetchIndex(ref.namespace);
  } catch (err: any) {
    s.stop(pc.red("Failed to fetch registry"));
    p.log.error(err.message);
    process.exit(1);
  }

  const indexItem = index.items.find((i) => i.name === ref.name);
  if (!indexItem) {
    s.stop(pc.red("Not found"));
    p.log.error(`Component '${ref.name}' not found in ${ref.namespace} registry.`);
    process.exit(1);
  }

  // Fetch full item (specific version or latest)
  const dir = typeToDir[indexItem.type] as any;
  let item;
  try {
    item = await fetcher.fetchItem(ref.name, dir, ref.namespace, ref.version);
  } catch (err: any) {
    s.stop(pc.red("Failed to fetch"));
    p.log.error(err.message);
    process.exit(1);
  }
  s.stop("");

  // Display
  const version = ref.version ?? item.version ?? "1.0.0";
  const typeName = item.type.replace("kitn:", "");

  p.log.message("");
  p.log.message(`  ${pc.bold(item.name)} ${pc.cyan(`v${version}`)}${pc.dim(`  ${ref.namespace}`)}`);
  p.log.message(`  ${item.description}`);
  p.log.message("");
  p.log.message(`  ${pc.dim("Type:")}           ${typeName}`);

  if (item.dependencies?.length) {
    p.log.message(`  ${pc.dim("Dependencies:")}   ${item.dependencies.join(", ")}`);
  }
  if (item.registryDependencies?.length) {
    p.log.message(`  ${pc.dim("Registry deps:")}  ${item.registryDependencies.join(", ")}`);
  }
  if (item.categories?.length) {
    p.log.message(`  ${pc.dim("Categories:")}     ${item.categories.join(", ")}`);
  }
  if (item.updatedAt) {
    p.log.message(`  ${pc.dim("Updated:")}        ${item.updatedAt}`);
  }

  // Available versions from index
  const versions = (indexItem as any).versions;
  if (versions?.length) {
    p.log.message(`  ${pc.dim("Versions:")}       ${versions.join(", ")}`);
  }

  // Changelog
  if (item.changelog?.length) {
    p.log.message("");
    p.log.message(`  ${pc.bold("Changelog:")}`);
    for (const entry of item.changelog) {
      const typeColor = entry.type === "breaking" ? pc.red : entry.type === "fix" ? pc.yellow : pc.green;
      p.log.message(`    ${pc.dim(entry.version)}  ${pc.dim(entry.date)}  ${typeColor(entry.type.padEnd(8))}  ${entry.note}`);
    }
  }

  // Files
  p.log.message("");
  p.log.message(`  ${pc.bold("Files:")} (${item.files.length})`);
  for (const file of item.files.slice(0, 10)) {
    p.log.message(`    ${pc.dim(file.path)}`);
  }
  if (item.files.length > 10) {
    p.log.message(`    ${pc.dim(`... and ${item.files.length - 10} more`)}`);
  }

  // Installed status
  const installed = config.installed?.[item.name];
  if (installed) {
    p.log.message("");
    p.log.message(`  ${pc.green("Installed")} v${installed.version}`);
    if (installed.version !== (item.version ?? "1.0.0")) {
      p.log.message(`  ${pc.yellow(`Update available: v${item.version}`)}`);
    }
  }

  p.log.message("");
}
```

**Step 2: Register in CLI**

In `packages/cli/src/index.ts`, add:

```ts
program
  .command("info")
  .description("Show details about a component")
  .argument("<component>", "component name (e.g. weather-agent, @acme/tool@1.0.0)")
  .action(async (component: string) => {
    const { infoCommand } = await import("./commands/info.js");
    await infoCommand(component);
  });
```

**Step 3: Build and test**

Run: `bun run --cwd packages/cli build && bun test`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add kitn info command for component details"
```

---

### Task 8: Update `kitn list` with versions and update indicators

**Files:**
- Modify: `packages/cli/src/commands/list.ts`

**Step 1: Update list command**

Rewrite the display loop to show versions and update indicators:

```ts
for (const item of items) {
  const inst = installed[item.name];
  if (opts.installed && !inst) continue;

  const version = pc.dim(`v${item.version ?? "1.0.0"}`);

  if (inst) {
    const status = pc.green("✓");
    const updateAvail = item.version && inst.version !== item.version
      ? pc.yellow(` ⬆ v${item.version} available`)
      : "";
    p.log.message(`  ${status} ${item.name.padEnd(20)} ${version}  ${pc.dim(item.description)}${updateAvail}`);
  } else {
    const status = pc.dim("○");
    p.log.message(`  ${status} ${item.name.padEnd(20)} ${version}  ${pc.dim(item.description)}`);
  }
}
```

Add a summary line at the end:

```ts
const installedCount = Object.keys(installed).length;
const availableCount = index.items.length - installedCount;
const updateCount = index.items.filter(i => {
  const inst = installed[i.name];
  return inst && i.version && inst.version !== i.version;
}).length;

p.log.message("");
const parts = [`${installedCount} installed`, `${availableCount} available`];
if (updateCount > 0) parts.push(`${updateCount} update${updateCount === 1 ? "" : "s"} available`);
p.log.message(pc.dim(`  ${parts.join(", ")}`));
```

Also update the `installed` reference from `config._installed` to `config.installed`.

**Step 2: Build and test**

Run: `bun run --cwd packages/cli build && bun test`

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: kitn list shows versions and update indicators"
```

---

### Task 9: Wire namespace into remaining commands (diff, remove, update)

**Files:**
- Modify: `packages/cli/src/commands/diff.ts`
- Modify: `packages/cli/src/commands/remove.ts`
- Modify: `packages/cli/src/commands/update.ts`

**Step 1: Update diff command**

Import `parseComponentRef`, parse the component input, pass namespace/version to fetcher. Update `_installed` → `installed` references.

**Step 2: Update remove command**

Import `parseComponentRef`, parse the component input. Look up in `installed` by either `name` (for @kitn) or `@namespace/name` (for third-party). Update `_installed` → `installed` references.

**Step 3: Update update command**

Update `_installed` → `installed` references. When updating all, pass through each installed entry's registry namespace.

**Step 4: Build and test**

Run: `bun run --cwd packages/cli build && bun test`

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: diff, remove, update commands support namespaces"
```

---

### Task 10: Update build script for versioned output and changelog

**Files:**
- Modify: `registry/scripts/build-registry.ts`

**Step 1: Add updatedAt stamping**

In `buildRegistryItem`, auto-stamp `updatedAt` with current ISO timestamp:

```ts
updatedAt: new Date().toISOString(),
```

**Step 2: Output versioned files**

After writing the latest file (`r/{type}/{name}.json`), also write the versioned file (`r/{type}/{name}@{version}.json`). Check if the versioned file already exists — if so, skip it (immutable).

```ts
// Write latest
await writeFile(join(outDir, `${manifest.name}.json`), JSON.stringify(item, null, 2) + "\n");

// Write versioned (immutable)
const versionedPath = join(outDir, `${manifest.name}@${manifest.version ?? "1.0.0"}.json`);
try {
  await readFile(versionedPath);
  // Already exists, skip
} catch {
  await writeFile(versionedPath, JSON.stringify(item, null, 2) + "\n");
  console.log(`  + ${typeDir}/${manifest.name}@${manifest.version ?? "1.0.0"}.json (versioned)`);
}
```

**Step 3: Add versions to registry index**

Scan the output directory for existing versioned files to build the `versions` array:

```ts
// Collect available versions by scanning existing @version files
const versions = [];
const dirEntries = await readdir(outDir);
for (const entry of dirEntries) {
  const match = entry.match(new RegExp(`^${manifest.name}@(.+)\\.json$`));
  if (match) versions.push(match[1]);
}
// Sort descending (newest first)
versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
```

Include `versions` and `updatedAt` in the registry index items.

**Step 4: Add changelog pass-through**

Include `changelog` from the manifest in the built registry item JSON.

**Step 5: Run build**

Run: `bun run registry/scripts/build-registry.ts`
Expected: Builds all components with versioned files

**Step 6: Verify output**

Check that versioned files exist:
```bash
ls registry/r/agents/ | head -20
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: build script outputs versioned files with changelog and updatedAt"
```

---

### Task 11: Add changelogs to existing component manifests

**Files:**
- Modify: all `registry/components/*/manifest.json` files

**Step 1: Add initial changelog to each manifest**

For each existing component manifest, add:
```json
{
  "changelog": [
    { "version": "1.0.0", "date": "2026-02-25", "type": "initial", "note": "Initial release" }
  ]
}
```

**Step 2: Rebuild registry**

Run: `bun run registry/scripts/build-registry.ts`

**Step 3: Commit**

```bash
git add -A && git commit -m "chore: add initial changelog entries to all component manifests"
```

---

### Task 12: Migrate registry to kitn-ai/registry repo

**Files:**
- New repo: `kitn-ai/registry`
- Remove from monorepo: `registry/` directory

**Step 1: Clone the empty registry repo**

```bash
cd /tmp && git clone git@github.com:kitn-ai/registry.git kitn-registry
```

**Step 2: Copy registry contents**

```bash
cp -r /path/to/kitn/registry/* /tmp/kitn-registry/
cp -r /path/to/kitn/registry/.* /tmp/kitn-registry/ 2>/dev/null || true
```

**Step 3: Copy package source snapshots**

```bash
mkdir -p /tmp/kitn-registry/packages/core /tmp/kitn-registry/packages/hono
cp -r /path/to/kitn/packages/core/src /tmp/kitn-registry/packages/core/src
cp -r /path/to/kitn/packages/hono/src /tmp/kitn-registry/packages/hono/src
```

**Step 4: Update package manifest paths**

Update `components/package/core/manifest.json`:
- `sourceDir`: `"../../../packages/core/src"` → `"../../packages/core/src"`

Update `components/package/hono/manifest.json`:
- `sourceDir`: `"../../../packages/hono/src"` → `"../../packages/hono/src"`

**Step 5: Create README.md**

Write a comprehensive README for the registry repo covering:
- What the registry is
- Directory structure
- How to add a component
- Manifest schema
- How to build
- How versions work

**Step 6: Add package.json**

Create a minimal `package.json` with the dependencies needed for the build script (zod, etc.).

**Step 7: Verify build works in new repo**

```bash
cd /tmp/kitn-registry && bun install && bun run scripts/build-registry.ts
```

**Step 8: Commit and push new repo**

```bash
cd /tmp/kitn-registry
git add -A
git commit -m "feat: initialize registry repo with components, packages, and build script"
git push origin main
```

**Step 9: Remove registry from monorepo**

Back in the kitn monorepo:
```bash
rm -rf registry/
```

Update any references to `registry/` in the monorepo (check for import paths, scripts, CI).

**Step 10: Update kitn.json registry URL**

The default registry URL changes from:
```
https://kitn-ai.github.io/kitn/r/{type}/{name}.json
```
To:
```
https://kitn-ai.github.io/registry/r/{type}/{name}.json
```

Update the default in `packages/cli/src/commands/init.ts`.

**Step 11: Commit monorepo changes**

```bash
git add -A && git commit -m "chore: remove registry directory (migrated to kitn-ai/registry)"
```

---

### Task 13: End-to-end verification

**Step 1: Build everything**

```bash
bun run --cwd packages/core build
bun run --cwd packages/hono build
bun run --cwd packages/cli build
```

**Step 2: Run all tests**

```bash
bun test
```

**Step 3: Verify new registry repo builds**

```bash
cd /tmp/kitn-registry && bun run scripts/build-registry.ts
```

**Step 4: Verify CLI commands**

- `kitn list` shows versions
- `kitn info weather-agent` shows details (may need local mock since registry isn't deployed yet)

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "chore: final verification and cleanup"
```

---

## Batch Execution Strategy

**Batch 1 (Tasks 1-3):** Schema foundation — rename installed, add changelog/updatedAt, add registry field
**Batch 2 (Tasks 4-5):** Parsing and fetching — parseComponentRef utility, fetcher namespace/version support
**Batch 3 (Tasks 6-8):** CLI commands — wire into add, create info command, update list
**Batch 4 (Tasks 9-11):** Remaining commands + build — diff/remove/update, build script, changelogs
**Batch 5 (Tasks 12-13):** Migration — move to new repo, verify everything
