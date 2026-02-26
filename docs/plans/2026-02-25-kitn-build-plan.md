# `kitn build` & `kitn create` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `kitn build` and `kitn create` commands to the CLI so anyone can package kitn components into registry-compatible JSON from any project.

**Architecture:** `kitn build` scans for `registry.json` files (or targets specific paths), reads source code, merges metadata from `package.json` when present, and writes static JSON output identical to what `kitn add` already consumes. `kitn create` scaffolds new components. Both follow existing CLI patterns (commander + @clack/prompts + picocolors).

**Tech Stack:** TypeScript, commander, @clack/prompts, picocolors, zod, bun:test

**Design doc:** `docs/plans/2026-02-25-kitn-build-design.md`

---

### Task 1: Add `registry.json` input schema

The `registry.json` file is the component metadata file that authors create. We need a zod schema to validate it.

**Files:**
- Modify: `packages/cli/src/registry/schema.ts`
- Create: `packages/cli/test/component-schema.test.ts`

**Step 1: Write the failing test**

Create `packages/cli/test/component-schema.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { componentConfigSchema } from "../src/registry/schema.js";

describe("componentConfigSchema", () => {
  test("validates a standalone component (no package.json)", () => {
    const result = componentConfigSchema.safeParse({
      name: "weather-tool",
      type: "kitn:tool",
      version: "1.0.0",
      description: "Get weather info",
      dependencies: ["ai", "zod"],
      files: ["weather.ts"],
      categories: ["weather"],
    });
    expect(result.success).toBe(true);
  });

  test("validates a package component (has package.json)", () => {
    const result = componentConfigSchema.safeParse({
      type: "kitn:package",
      installDir: "routes",
      registryDependencies: ["core"],
      tsconfig: { "@kitnai/hono": ["./index.ts"] },
      exclude: ["lib/auth.ts"],
      categories: ["http"],
    });
    expect(result.success).toBe(true);
  });

  test("requires type field", () => {
    const result = componentConfigSchema.safeParse({
      name: "test",
      version: "1.0.0",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid type", () => {
    const result = componentConfigSchema.safeParse({
      type: "kitn:invalid",
      name: "test",
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/component-schema.test.ts`
Expected: FAIL — `componentConfigSchema` does not exist

**Step 3: Implement the schema**

Add to `packages/cli/src/registry/schema.ts` (after existing exports, before `typeToDir`):

```typescript
/** Schema for the author-facing registry.json file */
export const componentConfigSchema = z.object({
  $schema: z.string().optional(),
  type: componentType,
  // These are required when no package.json exists alongside
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  // Dependencies
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  // Source specification
  files: z.array(z.string()).optional(),
  sourceDir: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  // Installation
  installDir: z.string().optional(),
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),
  // Metadata
  envVars: z.record(z.string(), z.string()).optional(),
  categories: z.array(z.string()).optional(),
  docs: z.string().optional(),
  changelog: z.array(changelogEntrySchema).optional(),
});
export type ComponentConfig = z.infer<typeof componentConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/cli/test/component-schema.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/cli/src/registry/schema.ts packages/cli/test/component-schema.test.ts
git commit -m "feat(cli): add componentConfigSchema for registry.json input files"
```

---

### Task 2: Build the component builder module

This is the core logic: read `registry.json` + optional `package.json` + source files, produce a `RegistryItem`.

**Files:**
- Create: `packages/cli/src/registry/builder.ts`
- Create: `packages/cli/test/builder.test.ts`

**Step 1: Write the failing tests**

Create `packages/cli/test/builder.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildComponent } from "../src/registry/builder.js";

describe("buildComponent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-build-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("builds a standalone single-file component", async () => {
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({
        name: "my-tool",
        type: "kitn:tool",
        version: "1.0.0",
        description: "A test tool",
        dependencies: ["ai", "zod"],
        files: ["my-tool.ts"],
        categories: ["test"],
      })
    );
    await writeFile(join(dir, "my-tool.ts"), 'export const myTool = "hello";');

    const item = await buildComponent(dir);

    expect(item.name).toBe("my-tool");
    expect(item.type).toBe("kitn:tool");
    expect(item.version).toBe("1.0.0");
    expect(item.description).toBe("A test tool");
    expect(item.dependencies).toEqual(["ai", "zod"]);
    expect(item.files).toHaveLength(1);
    expect(item.files[0].path).toBe("tools/my-tool.ts");
    expect(item.files[0].content).toBe('export const myTool = "hello";');
    expect(item.files[0].type).toBe("kitn:tool");
    expect(item.updatedAt).toBeDefined();
  });

  test("builds a package component merging from package.json", async () => {
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        installDir: "routes",
        registryDependencies: ["core"],
        tsconfig: { "@kitnai/hono": ["./index.ts"] },
        categories: ["http"],
      })
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@kitnai/hono",
        version: "0.2.0",
        description: "Hono adapter",
        dependencies: { "@scalar/hono-api-reference": "^0.9.0" },
        peerDependencies: { hono: "^4.0.0", "@hono/zod-openapi": "^1.0.0" },
        devDependencies: { typescript: "^5.0.0", "@types/bun": "^1.0.0" },
      })
    );
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "index.ts"), 'export const plugin = "hello";');
    await writeFile(join(dir, "src", "types.ts"), 'export type Config = {};');

    const item = await buildComponent(dir);

    expect(item.name).toBe("hono");
    expect(item.type).toBe("kitn:package");
    expect(item.version).toBe("0.2.0");
    expect(item.description).toBe("Hono adapter");
    expect(item.installDir).toBe("routes");
    expect(item.registryDependencies).toEqual(["core"]);
    // dependencies = deps + peerDeps (no versions, no workspace:*)
    expect(item.dependencies).toContain("hono");
    expect(item.dependencies).toContain("@hono/zod-openapi");
    expect(item.dependencies).toContain("@scalar/hono-api-reference");
    // devDependencies excludes build tooling
    expect(item.devDependencies).not.toContain("typescript");
    expect(item.devDependencies).not.toContain("@types/bun");
    // Files from src/
    expect(item.files).toHaveLength(2);
    expect(item.files.map((f: any) => f.path).sort()).toEqual([
      "routes/index.ts",
      "routes/types.ts",
    ]);
  });

  test("applies exclude list for packages", async () => {
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        installDir: "core",
        exclude: ["internal.ts"],
      })
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@kitnai/core",
        version: "1.0.0",
        description: "Core engine",
      })
    );
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "index.ts"), "export {};");
    await writeFile(join(dir, "src", "internal.ts"), "// excluded");

    const item = await buildComponent(dir);

    expect(item.files).toHaveLength(1);
    expect(item.files[0].path).toBe("core/index.ts");
  });

  test("throws if registry.json missing", async () => {
    await expect(buildComponent(dir)).rejects.toThrow("registry.json");
  });

  test("throws if standalone component missing required fields", async () => {
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({ type: "kitn:tool" })
    );
    await expect(buildComponent(dir)).rejects.toThrow("name");
  });

  test("strips @scope/ prefix from package.json name", async () => {
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({ type: "kitn:package", installDir: "test" })
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@kitnai/core",
        version: "1.0.0",
        description: "Core",
      })
    );
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "index.ts"), "export {};");

    const item = await buildComponent(dir);
    expect(item.name).toBe("core");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/builder.test.ts`
Expected: FAIL — `buildComponent` does not exist

**Step 3: Implement the builder**

Create `packages/cli/src/registry/builder.ts`:

```typescript
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import {
  componentConfigSchema,
  registryItemSchema,
  typeToDir,
  type ComponentConfig,
  type RegistryItem,
  type ComponentType,
} from "./schema.js";

/** Dependency package names to exclude from devDependencies output */
const DEV_DEP_EXCLUDE = new Set([
  "typescript",
  "@types/bun",
  "@types/node",
  "tsup",
  "vitest",
  "jest",
  "@types/jest",
]);

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

async function readDirRecursive(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      files.push(...(await readDirRecursive(fullPath, join(base, entry))));
    } else if (entry.endsWith(".ts")) {
      files.push(join(base, entry));
    }
  }
  return files;
}

function stripScope(name: string): string {
  return name.replace(/^@[^/]+\//, "");
}

function extractDeps(pkg: PackageJson): string[] {
  const deps = new Set<string>();
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!name.startsWith("workspace:") && !pkg.dependencies![name].startsWith("workspace:")) {
      deps.add(name);
    }
  }
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    deps.add(name);
  }
  return [...deps];
}

function extractDevDeps(pkg: PackageJson): string[] {
  return Object.keys(pkg.devDependencies ?? {}).filter(
    (name) => !DEV_DEP_EXCLUDE.has(name) && !name.startsWith("@types/")
  );
}

export async function buildComponent(componentDir: string): Promise<RegistryItem> {
  // 1. Read registry.json
  let rawConfig: unknown;
  try {
    rawConfig = await readJsonFile(join(componentDir, "registry.json"));
  } catch {
    throw new Error(`No registry.json found in ${componentDir}`);
  }

  const configResult = componentConfigSchema.safeParse(rawConfig);
  if (!configResult.success) {
    const issues = configResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid registry.json: ${issues}`);
  }
  const config = configResult.data;

  // 2. Try to read package.json
  let pkg: PackageJson | null = null;
  try {
    pkg = await readJsonFile<PackageJson>(join(componentDir, "package.json"));
  } catch {
    // No package.json — standalone component
  }

  // 3. Resolve metadata
  const name = config.name ?? (pkg?.name ? stripScope(pkg.name) : undefined);
  const version = config.version ?? pkg?.version;
  const description = config.description ?? pkg?.description;

  if (!name) throw new Error(`Missing "name" — add it to registry.json or provide a package.json`);
  if (!version) throw new Error(`Missing "version" — add it to registry.json or provide a package.json`);
  if (!description) throw new Error(`Missing "description" — add it to registry.json or provide a package.json`);

  // 4. Resolve dependencies
  const dependencies = config.dependencies ?? (pkg ? extractDeps(pkg) : undefined);
  const devDependencies = config.devDependencies ?? (pkg ? extractDevDeps(pkg) : undefined);

  // 5. Read source files
  const fileContents: Record<string, string> = {};

  if (config.type === "kitn:package") {
    const srcDir = join(componentDir, config.sourceDir ?? "src");
    const exclude = new Set(config.exclude ?? []);
    const tsFiles = await readDirRecursive(srcDir);
    for (const relPath of tsFiles) {
      if (exclude.has(relPath)) continue;
      fileContents[relPath] = await readFile(join(srcDir, relPath), "utf-8");
    }
  } else {
    if (!config.files || config.files.length === 0) {
      throw new Error(`Missing "files" in registry.json for ${config.type} component`);
    }
    for (const fileName of config.files) {
      fileContents[fileName] = await readFile(join(componentDir, fileName), "utf-8");
    }
  }

  // 6. Build files array
  const typeDir = config.type === "kitn:package"
    ? (config.installDir ?? name)
    : typeToDir[config.type];

  const files = Object.entries(fileContents).map(([relPath, content]) => ({
    path: `${typeDir}/${relPath}`,
    content,
    type: config.type,
  }));

  // 7. Produce and validate the registry item
  return registryItemSchema.parse({
    $schema: "https://kitn.dev/schema/registry-item.json",
    name,
    type: config.type,
    description,
    dependencies: dependencies?.length ? dependencies : undefined,
    devDependencies: devDependencies?.length ? devDependencies : undefined,
    registryDependencies: config.registryDependencies,
    envVars: config.envVars,
    files,
    installDir: config.installDir,
    tsconfig: config.tsconfig,
    docs: config.docs,
    categories: config.categories,
    version,
    updatedAt: new Date().toISOString(),
    changelog: config.changelog,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/cli/test/builder.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add packages/cli/src/registry/builder.ts packages/cli/test/builder.test.ts
git commit -m "feat(cli): add buildComponent function for registry.json → RegistryItem"
```

---

### Task 3: Build the scanner and output writer

This module discovers `registry.json` files and writes the output directory.

**Files:**
- Create: `packages/cli/src/registry/build-output.ts`
- Create: `packages/cli/test/build-output.test.ts`

**Step 1: Write the failing tests**

Create `packages/cli/test/build-output.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { scanForComponents, writeRegistryOutput } from "../src/registry/build-output.js";
import type { RegistryItem } from "../src/registry/schema.js";

describe("scanForComponents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-scan-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("finds registry.json files in directory tree", async () => {
    await mkdir(join(dir, "agents", "weather"), { recursive: true });
    await mkdir(join(dir, "tools", "search"), { recursive: true });
    await writeFile(join(dir, "agents", "weather", "registry.json"), "{}");
    await writeFile(join(dir, "tools", "search", "registry.json"), "{}");

    const paths = await scanForComponents(dir);
    expect(paths).toHaveLength(2);
    expect(paths.sort()).toEqual([
      join(dir, "agents", "weather"),
      join(dir, "tools", "search"),
    ]);
  });

  test("skips node_modules and dist", async () => {
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(dir, "dist", "r"), { recursive: true });
    await mkdir(join(dir, "real"), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg", "registry.json"), "{}");
    await writeFile(join(dir, "dist", "r", "registry.json"), "{}");
    await writeFile(join(dir, "real", "registry.json"), "{}");

    const paths = await scanForComponents(dir);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe(join(dir, "real"));
  });

  test("finds from specific paths", async () => {
    await mkdir(join(dir, "a"), { recursive: true });
    await mkdir(join(dir, "b"), { recursive: true });
    await mkdir(join(dir, "c"), { recursive: true });
    await writeFile(join(dir, "a", "registry.json"), "{}");
    await writeFile(join(dir, "b", "registry.json"), "{}");
    await writeFile(join(dir, "c", "registry.json"), "{}");

    const paths = await scanForComponents(dir, [join(dir, "a"), join(dir, "b")]);
    expect(paths).toHaveLength(2);
    expect(paths).not.toContain(join(dir, "c"));
  });
});

describe("writeRegistryOutput", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-output-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("writes component JSON and registry index", async () => {
    const items: RegistryItem[] = [
      {
        name: "my-tool",
        type: "kitn:tool",
        description: "test",
        files: [{ path: "tools/my-tool.ts", content: "export {};", type: "kitn:tool" }],
        version: "1.0.0",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    await writeRegistryOutput(dir, items);

    // Check latest file
    const latest = JSON.parse(await readFile(join(dir, "tools", "my-tool.json"), "utf-8"));
    expect(latest.name).toBe("my-tool");

    // Check versioned file
    const versioned = JSON.parse(await readFile(join(dir, "tools", "my-tool@1.0.0.json"), "utf-8"));
    expect(versioned.name).toBe("my-tool");

    // Check index
    const index = JSON.parse(await readFile(join(dir, "registry.json"), "utf-8"));
    expect(index.items).toHaveLength(1);
    expect(index.items[0].name).toBe("my-tool");
    expect(index.items[0].versions).toContain("1.0.0");
  });

  test("does not overwrite existing versioned files", async () => {
    await mkdir(join(dir, "tools"), { recursive: true });
    await writeFile(join(dir, "tools", "my-tool@1.0.0.json"), '{"original":true}');

    const items: RegistryItem[] = [
      {
        name: "my-tool",
        type: "kitn:tool",
        description: "test",
        files: [{ path: "tools/my-tool.ts", content: "export {};", type: "kitn:tool" }],
        version: "1.0.0",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    await writeRegistryOutput(dir, items);

    const versioned = JSON.parse(await readFile(join(dir, "tools", "my-tool@1.0.0.json"), "utf-8"));
    expect(versioned.original).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/build-output.test.ts`
Expected: FAIL — modules do not exist

**Step 3: Implement the scanner and writer**

Create `packages/cli/src/registry/build-output.ts`:

```typescript
import { readdir, stat, writeFile, mkdir, access, readFile } from "fs/promises";
import { join, resolve } from "path";
import { typeToDir, type RegistryItem, type RegistryIndex } from "./schema.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "r", "test", "tests", ".claude"]);

export async function scanForComponents(
  cwd: string,
  paths?: string[]
): Promise<string[]> {
  if (paths && paths.length > 0) {
    // Check each provided path for a registry.json
    const results: string[] = [];
    for (const p of paths) {
      const abs = resolve(cwd, p);
      // If the path itself is a directory with registry.json
      try {
        await access(join(abs, "registry.json"));
        results.push(abs);
      } catch {
        // Maybe it's a parent — scan one level
        try {
          const entries = await readdir(abs);
          for (const entry of entries) {
            const sub = join(abs, entry);
            const s = await stat(sub);
            if (s.isDirectory()) {
              try {
                await access(join(sub, "registry.json"));
                results.push(sub);
              } catch {
                // no registry.json here
              }
            }
          }
        } catch {
          // path doesn't exist or isn't a directory
        }
      }
    }
    return results;
  }

  // Full recursive scan
  return walkForRegistryJson(cwd);
}

async function walkForRegistryJson(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  let hasRegistryJson = false;
  const subdirs: string[] = [];

  for (const entry of entries) {
    if (entry === "registry.json") {
      hasRegistryJson = true;
      continue;
    }
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      subdirs.push(fullPath);
    }
  }

  if (hasRegistryJson) {
    results.push(dir);
  }

  for (const sub of subdirs) {
    results.push(...(await walkForRegistryJson(sub)));
  }

  return results;
}

export async function writeRegistryOutput(
  outputDir: string,
  items: RegistryItem[]
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];

  // Collect existing versioned files for version tracking
  const existingVersions = new Map<string, string[]>();

  for (const item of items) {
    const dir = typeToDir[item.type];
    const outDir = join(outputDir, dir);
    await mkdir(outDir, { recursive: true });

    // Write latest (always overwritten)
    const latestPath = join(outDir, `${item.name}.json`);
    await writeFile(latestPath, JSON.stringify(item, null, 2) + "\n");
    written.push(`${dir}/${item.name}.json`);

    // Write versioned (immutable)
    const version = item.version ?? "1.0.0";
    const versionedPath = join(outDir, `${item.name}@${version}.json`);
    try {
      await access(versionedPath);
      skipped.push(`${dir}/${item.name}@${version}.json`);
    } catch {
      await writeFile(versionedPath, JSON.stringify(item, null, 2) + "\n");
      written.push(`${dir}/${item.name}@${version}.json`);
    }

    // Scan for all existing versioned files
    const dirEntries = await readdir(outDir);
    const versions: string[] = [];
    const versionPattern = new RegExp(
      `^${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(.+)\\.json$`
    );
    for (const f of dirEntries) {
      const match = f.match(versionPattern);
      if (match) versions.push(match[1]);
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    existingVersions.set(item.name, versions);
  }

  // Write registry index
  const index: RegistryIndex = {
    $schema: "https://kitn.dev/schema/registry.json",
    version: "1.0.0",
    items: items.map(
      ({ name, type, description, registryDependencies, categories, version, updatedAt }) => ({
        name,
        type,
        description,
        registryDependencies,
        categories,
        version,
        versions: existingVersions.get(name) ?? [version ?? "1.0.0"],
        updatedAt,
      })
    ),
  };
  await writeFile(join(outputDir, "registry.json"), JSON.stringify(index, null, 2) + "\n");
  written.push("registry.json");

  return { written, skipped };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/cli/test/build-output.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add packages/cli/src/registry/build-output.ts packages/cli/test/build-output.test.ts
git commit -m "feat(cli): add component scanner and registry output writer"
```

---

### Task 4: Wire up the `kitn build` command

**Files:**
- Create: `packages/cli/src/commands/build.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement the command**

Create `packages/cli/src/commands/build.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { resolve } from "path";
import { scanForComponents, writeRegistryOutput } from "../registry/build-output.js";
import { buildComponent } from "../registry/builder.js";
import type { RegistryItem } from "../registry/schema.js";

interface BuildOptions {
  output?: string;
}

export async function buildCommand(paths: string[], opts: BuildOptions) {
  p.intro(pc.bgCyan(pc.black(" kitn build ")));

  const cwd = process.cwd();
  const outputDir = resolve(cwd, opts.output ?? "dist/r");

  const s = p.spinner();
  s.start("Scanning for registry.json files...");

  const componentDirs = await scanForComponents(
    cwd,
    paths.length > 0 ? paths : undefined
  );

  if (componentDirs.length === 0) {
    s.stop(pc.yellow("No registry.json files found"));
    p.outro(pc.dim("Create one with: kitn create <type> <name>"));
    return;
  }

  s.stop(
    `Found ${pc.bold(String(componentDirs.length))} component${componentDirs.length === 1 ? "" : "s"}`
  );

  for (const dir of componentDirs) {
    const rel = dir.replace(cwd + "/", "");
    p.log.info(pc.dim(`  ${rel}/registry.json`));
  }

  s.start("Building...");

  const items: RegistryItem[] = [];
  const errors: { dir: string; error: string }[] = [];

  for (const dir of componentDirs) {
    const rel = dir.replace(cwd + "/", "");
    try {
      const item = await buildComponent(dir);
      items.push(item);
    } catch (err: any) {
      errors.push({ dir: rel, error: err.message });
    }
  }

  if (errors.length > 0) {
    s.stop(pc.red("Build failed"));
    for (const { dir, error } of errors) {
      p.log.error(`${pc.bold(dir)}: ${error}`);
    }
    process.exit(1);
  }

  const { written, skipped } = await writeRegistryOutput(outputDir, items);

  s.stop(pc.green("Build complete"));

  for (const file of written) {
    p.log.success(pc.dim(`  ${file}`));
  }
  for (const file of skipped) {
    p.log.info(pc.dim(`  ${file} (exists, skipped)`));
  }

  const relOutput = outputDir.replace(cwd + "/", "");
  p.outro(`Output: ${pc.cyan(relOutput)}`);
}
```

**Step 2: Register in index.ts**

Add to `packages/cli/src/index.ts` after the `update` command block (after line 69):

```typescript
program
  .command("build")
  .description("Build registry JSON from components with registry.json files")
  .argument("[paths...]", "directories to build (default: scan from cwd)")
  .option("-o, --output <dir>", "output directory", "dist/r")
  .action(async (paths: string[], opts) => {
    const { buildCommand } = await import("./commands/build.js");
    await buildCommand(paths, opts);
  });
```

**Step 3: Build and verify**

Run: `bun run --cwd packages/cli build && bun run --cwd packages/cli typecheck`
Expected: both succeed

**Step 4: Commit**

```bash
git add packages/cli/src/commands/build.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn build command"
```

---

### Task 5: Wire up the `kitn create` command

**Files:**
- Create: `packages/cli/src/commands/create.ts`
- Create: `packages/cli/test/create.test.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Write the failing test**

Create `packages/cli/test/create.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createComponent } from "../src/commands/create.js";

describe("createComponent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-create-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("creates an agent component", async () => {
    await createComponent("agent", "weather-agent", { cwd: dir });

    const regPath = join(dir, "weather-agent", "registry.json");
    const srcPath = join(dir, "weather-agent", "weather-agent.ts");
    await access(regPath);
    await access(srcPath);

    const reg = JSON.parse(await readFile(regPath, "utf-8"));
    expect(reg.type).toBe("kitn:agent");
    expect(reg.name).toBe("weather-agent");
    expect(reg.files).toEqual(["weather-agent.ts"]);
  });

  test("creates a tool component", async () => {
    await createComponent("tool", "my-tool", { cwd: dir });

    const reg = JSON.parse(await readFile(join(dir, "my-tool", "registry.json"), "utf-8"));
    expect(reg.type).toBe("kitn:tool");
    expect(reg.dependencies).toContain("ai");
    expect(reg.dependencies).toContain("zod");

    const src = await readFile(join(dir, "my-tool", "my-tool.ts"), "utf-8");
    expect(src).toContain("tool(");
  });

  test("creates a skill component", async () => {
    await createComponent("skill", "my-skill", { cwd: dir });

    const reg = JSON.parse(await readFile(join(dir, "my-skill", "registry.json"), "utf-8"));
    expect(reg.type).toBe("kitn:skill");
    expect(reg.files).toEqual(["README.md"]);

    await access(join(dir, "my-skill", "README.md"));
  });

  test("creates a storage component", async () => {
    await createComponent("storage", "my-store", { cwd: dir });

    const reg = JSON.parse(await readFile(join(dir, "my-store", "registry.json"), "utf-8"));
    expect(reg.type).toBe("kitn:storage");

    const src = await readFile(join(dir, "my-store", "my-store.ts"), "utf-8");
    expect(src).toContain("StorageProvider");
  });

  test("throws if directory already exists", async () => {
    await createComponent("agent", "test-agent", { cwd: dir });
    await expect(createComponent("agent", "test-agent", { cwd: dir })).rejects.toThrow("already exists");
  });

  test("rejects invalid type", async () => {
    await expect(createComponent("invalid" as any, "test", { cwd: dir })).rejects.toThrow("type");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/create.test.ts`
Expected: FAIL — `createComponent` does not exist

**Step 3: Implement the create command**

Create `packages/cli/src/commands/create.ts`:

```typescript
import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFile, mkdir, access } from "fs/promises";
import { join, resolve } from "path";

const VALID_TYPES = ["agent", "tool", "skill", "storage"] as const;
type CreateType = (typeof VALID_TYPES)[number];

const TYPE_MAP: Record<CreateType, string> = {
  agent: "kitn:agent",
  tool: "kitn:tool",
  skill: "kitn:skill",
  storage: "kitn:storage",
};

interface CreateOptions {
  cwd?: string;
}

function agentTemplate(name: string): string {
  return `import type { AgentConfig } from "@kitnai/core";

export const ${toCamelCase(name)}Config: AgentConfig = {
  name: "${name}",
  description: "",
  system: "You are a helpful assistant.",
  tools: [],
};
`;
}

function toolTemplate(name: string): string {
  return `import { tool } from "ai";
import { z } from "zod";

export const ${toCamelCase(name)} = tool({
  description: "",
  inputSchema: z.object({
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    // TODO: implement
    return { result: input };
  },
});
`;
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: ""
---

# ${toTitleCase(name)}

Describe what this skill does and how to use it.
`;
}

function storageTemplate(name: string): string {
  return `import type { StorageProvider } from "@kitnai/core";

export function ${toCamelCase("create-" + name)}(config?: Record<string, unknown>): StorageProvider {
  // TODO: implement storage provider
  throw new Error("Not implemented");
}
`;
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function makeRegistryJson(type: CreateType, name: string, fileName: string): object {
  const base: Record<string, unknown> = {
    $schema: "https://kitn.dev/schema/registry.json",
    name,
    type: TYPE_MAP[type],
    version: "0.1.0",
    description: "",
    files: [fileName],
    categories: [],
  };

  if (type === "tool") {
    base.dependencies = ["ai", "zod"];
  } else if (type === "agent") {
    base.dependencies = [];
  } else if (type === "storage") {
    base.dependencies = [];
  }

  return base;
}

export async function createComponent(
  type: string,
  name: string,
  opts: CreateOptions = {}
): Promise<void> {
  if (!VALID_TYPES.includes(type as CreateType)) {
    throw new Error(`Invalid type "${type}". Must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const cwd = opts.cwd ?? process.cwd();
  const componentDir = join(cwd, name);

  try {
    await access(componentDir);
    throw new Error(`Directory "${name}" already exists`);
  } catch (err: any) {
    if (err.message.includes("already exists")) throw err;
    // Directory doesn't exist — good
  }

  await mkdir(componentDir, { recursive: true });

  const t = type as CreateType;
  let sourceFile: string;
  let sourceContent: string;

  switch (t) {
    case "agent":
      sourceFile = `${name}.ts`;
      sourceContent = agentTemplate(name);
      break;
    case "tool":
      sourceFile = `${name}.ts`;
      sourceContent = toolTemplate(name);
      break;
    case "skill":
      sourceFile = "README.md";
      sourceContent = skillTemplate(name);
      break;
    case "storage":
      sourceFile = `${name}.ts`;
      sourceContent = storageTemplate(name);
      break;
  }

  const registryJson = makeRegistryJson(t, name, sourceFile);

  await writeFile(join(componentDir, "registry.json"), JSON.stringify(registryJson, null, 2) + "\n");
  await writeFile(join(componentDir, sourceFile), sourceContent);
}

export async function createCommand(type: string, name: string) {
  p.intro(pc.bgCyan(pc.black(" kitn create ")));

  try {
    await createComponent(type, name);
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  p.log.success(`Created ${pc.bold(name)}/`);
  p.log.info(pc.dim(`  registry.json`));
  p.log.info(pc.dim(`  ${type === "skill" ? "README.md" : `${name}.ts`}`));
  p.outro(`Next: edit ${pc.cyan(`${name}/${type === "skill" ? "README.md" : `${name}.ts`}`)}, then run ${pc.cyan("kitn build")}`);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/cli/test/create.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Register in index.ts**

Add to `packages/cli/src/index.ts` after the `build` command block:

```typescript
program
  .command("create")
  .description("Scaffold a new kitn component")
  .argument("<type>", "component type (agent, tool, skill, storage)")
  .argument("<name>", "component name")
  .action(async (type: string, name: string) => {
    const { createCommand } = await import("./commands/create.js");
    await createCommand(type, name);
  });
```

**Step 6: Build and run tests**

Run: `bun run --cwd packages/cli build && bun run --cwd packages/cli test`
Expected: all pass

**Step 7: Commit**

```bash
git add packages/cli/src/commands/create.ts packages/cli/test/create.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn create command for scaffolding components"
```

---

### Task 6: Integration test — build the kitn hono package

Test `kitn build` against the real `packages/hono` by adding a `registry.json` to it.

**Files:**
- Create: `packages/hono/registry.json`
- Create: `packages/core/registry.json`

**Step 1: Create registry.json for core**

Create `packages/core/registry.json`:

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "type": "kitn:package",
  "installDir": "core",
  "registryDependencies": [],
  "tsconfig": {
    "@kitnai/core": ["./index.ts"]
  },
  "docs": "Engine installed to your project. Import with: import { ... } from '@kitnai/core'",
  "categories": ["engine", "core"]
}
```

**Step 2: Create registry.json for hono**

Create `packages/hono/registry.json`:

```json
{
  "$schema": "https://kitn.dev/schema/registry.json",
  "type": "kitn:package",
  "installDir": "routes",
  "registryDependencies": ["core"],
  "tsconfig": {
    "@kitnai/hono": ["./index.ts"]
  },
  "exclude": ["lib/auth.ts"],
  "docs": "Routes installed to your project. Import with: import { ... } from '@kitnai/hono'",
  "categories": ["http", "hono"]
}
```

**Step 3: Run kitn build on just hono**

Run: `cd /Users/home/Projects/kitn-ai/kitn && npx tsx packages/cli/src/index.ts build packages/hono`

Or if the CLI is built: `bun run --cwd packages/cli build && node packages/cli/dist/index.js build packages/hono`

Expected output:
```
 kitn build
Found 1 component
  packages/hono/registry.json
Building...
Build complete
  package/hono.json
  package/hono@0.1.0.json (versioned)
  registry.json
Output: dist/r
```

**Step 4: Verify the output**

Run: `cat dist/r/package/hono.json | head -20`

Verify:
- `name` is `"hono"` (stripped `@kitnai/`)
- `version` is from `packages/hono/package.json`
- `files` array contains all `.ts` files from `packages/hono/src/`
- `dependencies` includes `hono`, `@hono/zod-openapi`, etc.
- `installDir` is `"routes"`

**Step 5: Run build on everything**

Run: `node packages/cli/dist/index.js build`

Expected: finds both `packages/core/registry.json` and `packages/hono/registry.json`, builds both.

**Step 6: Commit**

```bash
git add packages/core/registry.json packages/hono/registry.json
git commit -m "feat: add registry.json to core and hono packages"
```

**Step 7: Clean up**

Remove `dist/r/` from version control if it was created:

```bash
echo "dist/" >> .gitignore  # if not already there
rm -rf dist/r/
```

---

### Task 7: Full test suite pass and typecheck

**Step 1: Run all tests**

Run: `bun run test`
Expected: all tests pass across all packages

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors

**Step 3: Run build**

Run: `bun run build`
Expected: all packages build successfully

**Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: resolve test and typecheck issues from kitn build feature"
```
