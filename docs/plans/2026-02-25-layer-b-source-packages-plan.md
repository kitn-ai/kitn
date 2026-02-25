# Layer B: Source-Installable Packages — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable `kitn add core` and `kitn add routes` to install framework source as owned code, with auto-patched tsconfig paths and a simplified `kitn init` flow.

**Architecture:** Extend the existing registry schema with `kitn:package` type, update the build script to read from monorepo package sources, modify the CLI's init/add commands to handle multi-file package installs with tsconfig patching. Remove auth from hono package.

**Tech Stack:** TypeScript, Zod schemas, Commander.js CLI, @clack/prompts, Bun test runner

---

### Task 1: Remove auth from hono package

**Files:**
- Delete: `packages/hono/src/lib/auth.ts`
- Modify: `packages/hono/src/index.ts`
- Modify: `packages/hono/src/types.ts`
- Modify: `packages/hono/src/plugin.ts`
- Modify: `examples/api/src/index.ts`

**Step 1: Delete auth.ts**

Remove `packages/hono/src/lib/auth.ts` entirely.

**Step 2: Remove auth export from index.ts**

In `packages/hono/src/index.ts`, remove the line:
```ts
export { createApiKeyAuth } from "./lib/auth.js";
```

**Step 3: Remove authMiddleware from types.ts**

In `packages/hono/src/types.ts`, remove `authMiddleware?: MiddlewareHandler;` from the config interface.

**Step 4: Remove auth middleware wiring from plugin.ts**

In `packages/hono/src/plugin.ts`, remove the auth middleware block (lines ~73-75):
```ts
if (config.authMiddleware) {
  app.use("/*", config.authMiddleware);
}
```

**Step 5: Update api example**

In `examples/api/src/index.ts`:
- Remove `createApiKeyAuth` from the import
- Remove `authMiddleware: createApiKeyAuth(env.API_KEY)` from the config
- The example can add its own auth middleware directly on the Hono app if desired

**Step 6: Verify builds**

Run: `bun run --cwd packages/hono build && bun run --cwd packages/core build`
Expected: Clean build, no errors

**Step 7: Run tests**

Run: `bun test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add -A && git commit -m "chore: remove auth middleware from hono package"
```

---

### Task 2: Extend registry schema with `kitn:package` type

**Files:**
- Modify: `registry/src/schema.ts`
- Modify: `packages/cli/src/registry/schema.ts`
- Modify: `packages/cli/src/utils/config.ts`

**Step 1: Write failing test**

Create `packages/cli/test/schema.test.ts`:
```ts
import { describe, test, expect } from "bun:test";
import { registryItemSchema, configSchema } from "../src/registry/schema.js";

describe("registry schema", () => {
  test("accepts kitn:package type", () => {
    const item = {
      name: "core",
      type: "kitn:package",
      description: "Framework-agnostic engine",
      files: [{ path: "core/index.ts", content: "export {}", type: "kitn:package" }],
      installDir: "core",
      tsconfig: { "@kitnai/core": ["./index.ts"] },
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("package requires installDir", () => {
    const item = {
      name: "core",
      type: "kitn:package",
      description: "test",
      files: [{ path: "core/index.ts", content: "", type: "kitn:package" }],
    };
    // installDir is optional in schema, but packages should have it
    const parsed = registryItemSchema.parse(item);
    expect(parsed.installDir).toBeUndefined();
  });
});

describe("config schema", () => {
  test("accepts framework field", () => {
    const config = {
      runtime: "bun",
      framework: "hono",
      aliases: {
        base: "src/ai",
        agents: "src/ai/agents",
        tools: "src/ai/tools",
        skills: "src/ai/skills",
        storage: "src/ai/storage",
      },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });

  test("accepts config without framework (backwards compat)", () => {
    const config = {
      runtime: "bun",
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/schema.test.ts`
Expected: FAIL — `kitn:package` not in enum, `framework` not in schema, `base` not in aliases

**Step 3: Update `packages/cli/src/registry/schema.ts`**

Add `kitn:package` to component type enum. Add `installDir` and `tsconfig` to registry item schema:

```ts
export const componentType = z.enum([
  "kitn:agent",
  "kitn:tool",
  "kitn:skill",
  "kitn:storage",
  "kitn:package",
]);

export const registryItemSchema = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  type: componentType,
  description: z.string(),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  files: z.array(registryFileSchema),
  docs: z.string().optional(),
  categories: z.array(z.string()).optional(),
  version: z.string().optional(),
  installDir: z.string().optional(),
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),
});

export const typeToDir: Record<ComponentType, string> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
  "kitn:package": "package",
};
```

**Step 4: Update `packages/cli/src/utils/config.ts`**

Add `framework` and `base` to config schema. Make `framework` and `base` optional for backwards compatibility:

```ts
const configSchema = z.object({
  $schema: z.string().optional(),
  runtime: z.enum(["bun", "node", "deno"]),
  framework: z.enum(["hono", "cloudflare", "elysia", "fastify", "express"]).optional(),
  aliases: z.object({
    base: z.string().optional(),
    agents: z.string(),
    tools: z.string(),
    skills: z.string(),
    storage: z.string(),
  }),
  registries: z.record(z.string(), z.string()),
  _installed: z.record(z.string(), installedComponentSchema).optional(),
});
```

**Step 5: Update `registry/src/schema.ts`**

Mirror the same changes — add `kitn:package` to enum, `installDir` and `tsconfig` to item schema:

```ts
export const componentType = z.enum([
  "kitn:agent",
  "kitn:tool",
  "kitn:skill",
  "kitn:storage",
  "kitn:package",
]);

export const registryItemSchema = z.object({
  // ... existing fields ...
  installDir: z.string().optional(),
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),
});
```

**Step 6: Run tests**

Run: `bun test packages/cli/test/schema.test.ts`
Expected: All pass

Run: `bun test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add kitn:package type and framework config to schemas"
```

---

### Task 3: Update `kitn init` command

**Files:**
- Modify: `packages/cli/src/commands/init.ts`

**Step 1: Rewrite init command**

Replace the current 4-directory-prompt flow with the new 3-prompt flow:

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";

export async function initCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn ")));

  const cwd = process.cwd();

  const existing = await readConfig(cwd);
  if (existing) {
    p.log.warn("kitn.json already exists in this directory.");
    const shouldContinue = await p.confirm({
      message: "Overwrite existing configuration?",
      initialValue: false,
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
  }

  const runtime = await p.select({
    message: "Which runtime do you use?",
    options: [
      { value: "bun", label: "Bun", hint: "recommended" },
      { value: "node", label: "Node.js" },
      { value: "deno", label: "Deno" },
    ],
  });
  if (p.isCancel(runtime)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const framework = await p.select({
    message: "Which framework are you using?",
    options: [
      { value: "hono", label: "Hono", hint: "recommended" },
      { value: "cloudflare", label: "Cloudflare Workers", hint: "coming soon" },
      { value: "elysia", label: "Elysia", hint: "coming soon" },
      { value: "fastify", label: "Fastify", hint: "coming soon" },
      { value: "express", label: "Express", hint: "coming soon" },
    ],
  });
  if (p.isCancel(framework)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const base = await p.text({
    message: "Where should kitn packages be installed?",
    initialValue: "src/ai",
    placeholder: "src/ai",
  });
  if (p.isCancel(base)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const baseDir = base as string;
  const config = {
    runtime: runtime as "bun" | "node" | "deno",
    framework: framework as "hono" | "cloudflare" | "elysia" | "fastify" | "express",
    aliases: {
      base: baseDir,
      agents: `${baseDir}/agents`,
      tools: `${baseDir}/tools`,
      skills: `${baseDir}/skills`,
      storage: `${baseDir}/storage`,
    },
    registries: {
      "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
    },
  };

  const s = p.spinner();
  s.start("Writing kitn.json");
  await writeConfig(cwd, config);
  s.stop("Created kitn.json");

  p.outro(pc.green("Done! Run `kitn add core` to install the engine, then `kitn add routes` for HTTP routes."));
}
```

**Step 2: Build CLI**

Run: `bun run --cwd packages/cli build`
Expected: Clean build

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: simplify kitn init with framework and base directory prompts"
```

---

### Task 4: Create tsconfig patcher utility

**Files:**
- Create: `packages/cli/src/installers/tsconfig-patcher.ts`
- Create: `packages/cli/test/tsconfig-patcher.test.ts`

**Step 1: Write failing tests**

Create `packages/cli/test/tsconfig-patcher.test.ts`:
```ts
import { describe, test, expect } from "bun:test";
import { patchTsconfig } from "../src/installers/tsconfig-patcher.js";

describe("tsconfig patcher", () => {
  test("adds paths to empty tsconfig", () => {
    const input = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}';
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
    expect(parsed.compilerOptions.strict).toBe(true);
  });

  test("merges paths into existing paths", () => {
    const input = JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    }, null, 2);
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("overwrites existing package path", () => {
    const input = JSON.stringify({
      compilerOptions: {
        paths: { "@kitnai/core": ["./old/path/index.ts"] },
      },
    }, null, 2);
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("creates compilerOptions if missing", () => {
    const input = "{}";
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("handles multiple paths at once", () => {
    const input = '{ "compilerOptions": {} }';
    const result = patchTsconfig(input, {
      "@kitnai/core": ["./src/ai/core/index.ts"],
      "@kitnai/hono": ["./src/ai/routes/index.ts"],
    });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
    expect(parsed.compilerOptions.paths["@kitnai/hono"]).toEqual(["./src/ai/routes/index.ts"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/test/tsconfig-patcher.test.ts`
Expected: FAIL — module not found

**Step 3: Implement tsconfig patcher**

Create `packages/cli/src/installers/tsconfig-patcher.ts`:
```ts
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Patches a tsconfig JSON string with additional paths entries.
 * Returns the updated JSON string.
 */
export function patchTsconfig(
  tsconfigContent: string,
  paths: Record<string, string[]>,
): string {
  const config = JSON.parse(tsconfigContent);

  if (!config.compilerOptions) {
    config.compilerOptions = {};
  }
  if (!config.compilerOptions.paths) {
    config.compilerOptions.paths = {};
  }

  for (const [key, value] of Object.entries(paths)) {
    config.compilerOptions.paths[key] = value;
  }

  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Reads tsconfig.json from projectDir, patches paths, and writes it back.
 * If no tsconfig.json exists, creates one with just the paths.
 */
export async function patchProjectTsconfig(
  projectDir: string,
  paths: Record<string, string[]>,
): Promise<void> {
  const tsconfigPath = join(projectDir, "tsconfig.json");
  let content: string;
  try {
    content = await readFile(tsconfigPath, "utf-8");
  } catch {
    content = "{}";
  }

  const patched = patchTsconfig(content, paths);
  await writeFile(tsconfigPath, patched);
}
```

**Step 4: Run tests**

Run: `bun test packages/cli/test/tsconfig-patcher.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add tsconfig patcher utility for package installs"
```

---

### Task 5: Update `kitn add` to handle packages

**Files:**
- Modify: `packages/cli/src/commands/add.ts`
- Modify: `packages/cli/src/registry/fetcher.ts`

**Step 1: Update fetcher to handle `routes` → framework-specific package resolution**

In `packages/cli/src/registry/fetcher.ts`, the `TypeDir` type needs `"package"`. The `fetchItem` and `resolveUrl` methods already work generically, but the caller in `add.ts` needs to map `"routes"` to the framework-specific package name.

Update `TypeDir`:
```ts
type TypeDir = "agents" | "tools" | "skills" | "storage" | "package";
```

**Step 2: Update add command to handle kitn:package installs**

The main changes to `packages/cli/src/commands/add.ts`:

1. When resolving component type, handle the special `"routes"` name — look up `config.framework` and map to the actual package name (e.g. `"hono"`).
2. When `item.type === "kitn:package"`:
   - Use `item.installDir` to determine target directory under `config.aliases.base`
   - Preserve directory structure (don't flatten to single file)
   - After writing files, call `patchProjectTsconfig` with resolved paths
3. For regular components, behavior stays the same but use the `base` alias if it exists.

Key code changes in the install loop — when `item.type === "kitn:package"`:

```ts
import { patchProjectTsconfig } from "../installers/tsconfig-patcher.js";

// Inside the install loop, for packages:
if (item.type === "kitn:package") {
  const baseDir = config.aliases.base ?? "src/ai";
  const installDir = item.installDir ?? item.name;

  for (const file of item.files) {
    // file.path is like "core/agents/orchestrator.ts"
    // Install to: {base}/{file.path} e.g. "src/ai/core/agents/orchestrator.ts"
    const targetPath = join(cwd, baseDir, file.path);
    const relativePath = join(baseDir, file.path);

    const status = await checkFileStatus(targetPath, file.content);
    // ... same new/identical/different handling as regular components ...
  }

  // Patch tsconfig if package has tsconfig field
  if (item.tsconfig) {
    const resolvedPaths: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(item.tsconfig)) {
      resolvedPaths[key] = values.map((v) => `./${join(baseDir, installDir, v)}`);
    }
    await patchProjectTsconfig(cwd, resolvedPaths);
  }

  // Track in _installed
  const installed = config._installed ?? {};
  const allContent = item.files.map((f) => f.content).join("\n");
  installed[item.name] = {
    version: item.version ?? "1.0.0",
    installedAt: new Date().toISOString(),
    files: item.files.map((f) => join(baseDir, f.path)),
    hash: contentHash(allContent),
  };
  config._installed = installed;
}
```

For the `"routes"` name resolution, add logic at the top of `addCommand`:

```ts
// Resolve "routes" to framework-specific package name
const resolvedComponents = components.map((c) => {
  if (c === "routes") {
    const fw = config.framework ?? "hono";
    return fw; // "hono" → fetches package/hono from registry
  }
  return c;
});
```

And update the resolver's fetch callback to handle package types:

```ts
resolved = await resolveDependencies(resolvedComponents, async (name) => {
  const index = await fetcher.fetchIndex();
  const indexItem = index.items.find((i) => i.name === name);
  if (!indexItem) throw new Error(`Component '${name}' not found in registry`);
  const dir = typeToDir[indexItem.type];
  return fetcher.fetchItem(name, dir as any);
});
```

This already works because `typeToDir["kitn:package"]` will be `"package"` and the URL template fills in correctly: `r/package/core.json`.

**Step 3: Build CLI**

Run: `bun run --cwd packages/cli build`
Expected: Clean build

**Step 4: Run all tests**

Run: `bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: kitn add supports package installs with tsconfig patching"
```

---

### Task 6: Update registry build script for packages

**Files:**
- Modify: `registry/scripts/build-registry.ts`
- Create: `registry/components/package/core/manifest.json`
- Create: `registry/components/package/hono/manifest.json`

**Step 1: Create package manifests**

Create `registry/components/package/core/manifest.json`:
```json
{
  "name": "core",
  "type": "kitn:package",
  "description": "Framework-agnostic AI agent engine — agents, tools, storage, streaming, events, voice",
  "sourceDir": "../../../packages/core/src",
  "installDir": "core",
  "dependencies": ["ai", "zod"],
  "devDependencies": ["@asteasolutions/zod-to-openapi"],
  "registryDependencies": [],
  "tsconfig": {
    "@kitnai/core": ["./index.ts"]
  },
  "docs": "Engine installed to your project. Import with: import { ... } from '@kitnai/core'",
  "version": "1.0.0"
}
```

Create `registry/components/package/hono/manifest.json`:
```json
{
  "name": "hono",
  "type": "kitn:package",
  "description": "Hono HTTP adapter with routes for kitn AI agents",
  "sourceDir": "../../../packages/hono/src",
  "installDir": "routes",
  "dependencies": ["hono", "@hono/zod-openapi", "@scalar/hono-api-reference"],
  "registryDependencies": ["core"],
  "exclude": ["lib/auth.ts"],
  "tsconfig": {
    "@kitnai/hono": ["./index.ts"]
  },
  "docs": "Routes installed to your project. Import with: import { ... } from '@kitnai/hono'",
  "version": "1.0.0"
}
```

**Step 2: Update build script**

In `registry/scripts/build-registry.ts`, extend the main loop to also scan `package/` directories. For packages, read all `.ts` files recursively from `sourceDir` instead of reading individually listed files:

```ts
// Add to the typeDir loop — also handle "package"
for (const typeDir of ["agents", "tools", "skills", "storage", "package"]) {
  // ... existing loop ...

  // For packages, handle sourceDir and recursive file reading
  if (manifest.type === "kitn:package" && manifest.sourceDir) {
    const srcDir = join(componentDir, manifest.sourceDir);
    const exclude = new Set(manifest.exclude ?? []);
    const files = await readDirRecursive(srcDir);

    for (const relPath of files) {
      if (exclude.has(relPath)) continue;
      const content = await readFile(join(srcDir, relPath), "utf-8");
      fileContents[relPath] = content;
    }
    // ... build item with installDir-prefixed paths ...
  }
}
```

Add a `readDirRecursive` helper that returns all `.ts` file paths relative to the root:

```ts
async function readDirRecursive(dir: string, base = ""): Promise<string[]> {
  const { readdir, stat } = await import("fs/promises");
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      files.push(...await readDirRecursive(fullPath, join(base, entry)));
    } else if (entry.endsWith(".ts")) {
      files.push(join(base, entry));
    }
  }
  return files;
}
```

Update `buildRegistryItem` to handle packages — file paths should be `{installDir}/{relativePath}`:

```ts
export function buildRegistryItem(
  manifest: ComponentManifest,
  fileContents: Record<string, string>
): RegistryItem {
  let files;
  if (manifest.type === "kitn:package") {
    const installDir = manifest.installDir ?? manifest.name;
    files = Object.entries(fileContents).map(([relPath, content]) => ({
      path: `${installDir}/${relPath}`,
      content,
      type: manifest.type,
    }));
  } else {
    const dir = typeToDir[manifest.type];
    files = manifest.files!.map((fileName) => ({
      path: `${dir}/${fileName}`,
      content: fileContents[fileName] ?? "",
      type: manifest.type,
    }));
  }

  return registryItemSchema.parse({
    $schema: "https://kitn.dev/schema/registry-item.json",
    name: manifest.name,
    type: manifest.type,
    description: manifest.description,
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    registryDependencies: manifest.registryDependencies,
    envVars: manifest.envVars,
    files,
    docs: manifest.docs,
    categories: manifest.categories,
    version: manifest.version ?? "1.0.0",
    installDir: manifest.installDir,
    tsconfig: manifest.tsconfig,
  });
}
```

Update the `registry/src/schema.ts` to match — the same changes from Task 2 but for the registry's own copy.

**Step 3: Run build**

Run: `bun run registry/scripts/build-registry.ts`
Expected: Builds all components + 2 packages, outputs `r/package/core.json` and `r/package/hono.json`

**Step 4: Validate the built JSON**

Run: `cat registry/r/package/core.json | head -20` — verify structure
Run: `cat registry/r/package/hono.json | head -20` — verify structure, confirm no auth.ts file present

**Step 5: Run existing registry validation**

Run: `bun run registry/scripts/validate.ts` (if exists)
Expected: All components + packages validate

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: registry build script handles kitn:package with source dir reading"
```

---

### Task 7: Update remaining CLI commands for package awareness

**Files:**
- Modify: `packages/cli/src/commands/list.ts`
- Modify: `packages/cli/src/commands/remove.ts`
- Modify: `packages/cli/src/commands/diff.ts`
- Modify: `packages/cli/src/commands/update.ts`

**Step 1: Read each command file**

Read `list.ts`, `remove.ts`, `diff.ts`, `update.ts` to understand current behavior.

**Step 2: Update list command**

The list command shows available components. It needs to:
- Include packages in the listing
- Show them as a distinct type (e.g. `[package]` instead of `[agent]`)

**Step 3: Update remove command**

When removing a package:
- Delete all files tracked in `_installed[name].files`
- Remove the tsconfig paths entry
- Clean up empty directories

**Step 4: Update diff command**

Should work with packages — diff against registry version for all files in the package.

**Step 5: Update update command**

The update command delegates to `add --overwrite`. It needs to handle:
- `kitn update core` — re-installs core package
- `kitn update routes` — resolves to framework-specific package, re-installs
- `kitn update` (no args) — updates all installed items including packages

**Step 6: Build and test**

Run: `bun run --cwd packages/cli build && bun test`
Expected: All pass

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: list, remove, diff, update commands support packages"
```

---

### Task 8: End-to-end verification

**Files:**
- None new — testing existing work

**Step 1: Build everything**

```bash
bun run --cwd packages/core build
bun run --cwd packages/hono build
bun run --cwd packages/cli build
bun run registry/scripts/build-registry.ts
```
Expected: All clean

**Step 2: Run all tests**

```bash
bun test
```
Expected: All pass

**Step 3: Verify registry output**

Check that `registry/r/package/core.json` and `registry/r/package/hono.json`:
- Have correct `type: "kitn:package"`
- Have `installDir` and `tsconfig` fields
- Have all expected files (no auth.ts in hono)
- Files have preserved directory structure in paths

**Step 4: Verify no auth references remain in hono**

```bash
grep -r "createApiKeyAuth\|auth\.ts\|auth\.js" packages/hono/src/
```
Expected: No matches

**Step 5: Typecheck examples**

```bash
bunx tsc --noEmit -p examples/api/tsconfig.json
```
Expected: Clean

**Step 6: Commit any final fixes**

```bash
git add -A && git commit -m "chore: final verification and cleanup for Layer B"
```

---

## Batch Execution Strategy

**Batch 1 (Tasks 1-2):** Auth removal + schema changes — independent foundation work
**Batch 2 (Tasks 3-4):** Init rewrite + tsconfig patcher — CLI user-facing changes
**Batch 3 (Tasks 5-6):** Add command update + registry build — the core feature
**Batch 4 (Tasks 7-8):** Supporting commands + verification — polish and validation
