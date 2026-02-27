import { registryItemSchema, typeToAliasKey } from "../src/schema.js";
import type { RegistryItem, RegistryIndex, ComponentType, ChangelogEntry } from "../src/schema.js";

interface ComponentManifest {
  name: string;
  type: ComponentType;
  description: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  envVars?: Record<string, { description: string; required?: boolean; secret?: boolean; url?: string }>;
  files?: string[];           // for regular components
  sourceDir?: string;         // for packages (relative path to source)
  installDir?: string;        // target directory name
  exclude?: string[];         // files to exclude from source
  tsconfig?: Record<string, string[]>;  // tsconfig paths
  slot?: string;              // exclusive slot — components sharing a slot conflict
  docs?: string;
  categories?: string[];
  version?: string;
  changelog?: ChangelogEntry[];
}

const typeToDir: Record<ComponentType, string> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
  "kitn:package": "package",
};

/**
 * Rewrite monorepo package imports to user-facing tsconfig aliases.
 * e.g. `@kitnai/core` → `@kitn/core`, `@kitnai/hono-adapter` → `@kitn/adapters/hono`
 */
const PACKAGE_IMPORT_REWRITES: Record<string, string> = {
  "@kitnai/core": "@kitn/core",
  "@kitnai/hono-adapter": "@kitn/adapters/hono",
  "@kitnai/hono-openapi-adapter": "@kitn/adapters/hono-openapi",
  "@kitnai/elysia-adapter": "@kitn/adapters/elysia",
};

function rewritePackageImports(content: string): string {
  for (const [from, to] of Object.entries(PACKAGE_IMPORT_REWRITES)) {
    content = content.replaceAll(from, to);
  }
  return content;
}

async function readDirRecursive(dir: string, base = ""): Promise<string[]> {
  const { readdir, stat } = await import("fs/promises");
  const { join } = await import("path");
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
    slot: manifest.slot,
    version: manifest.version ?? "1.0.0",
    installDir: manifest.installDir,
    tsconfig: manifest.tsconfig,
    updatedAt: new Date().toISOString(),
    changelog: manifest.changelog,
  });
}

export function buildRegistryIndex(
  items: RegistryItem[],
  existingVersions: Map<string, string[]> = new Map()
): RegistryIndex {
  return {
    $schema: "https://kitn.dev/schema/registry.json",
    version: "1.0.0",
    items: items.map(({ name, type, description, registryDependencies, categories, slot, version, updatedAt }) => ({
      name,
      type,
      description,
      registryDependencies,
      categories,
      slot,
      version,
      versions: existingVersions.get(name) ?? [version ?? "1.0.0"],
      updatedAt,
    })),
  };
}

// CLI entry point — run with `bun run scripts/build-registry.ts`
if (import.meta.main) {
  const { readdir, readFile, writeFile, mkdir, access } = await import("fs/promises");
  const { join } = await import("path");

  const ROOT = new URL("..", import.meta.url).pathname;
  const REPO_ROOT = new URL("../..", import.meta.url).pathname;
  const COMPONENTS_DIR = join(ROOT, "components");
  const OUTPUT_DIR = join(ROOT, "r");

  const allItems: RegistryItem[] = [];
  const existingVersions = new Map<string, string[]>();

  /** Recursively find all directories containing a manifest.json. */
  async function findManifestDirs(base: string): Promise<string[]> {
    const results: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = join(base, entry);
      const s = await (await import("fs/promises")).stat(full);
      if (!s.isDirectory()) continue;
      try {
        await access(join(full, "manifest.json"));
        results.push(full);
      } catch {
        // No manifest here — recurse into subdirectories
        results.push(...await findManifestDirs(full));
      }
    }
    return results;
  }

  for (const typeDir of ["agents", "tools", "skills", "storage", "package"]) {
    const dir = join(COMPONENTS_DIR, typeDir);
    const manifestDirs = await findManifestDirs(dir);

    for (const componentDir of manifestDirs) {
      const manifestPath = join(componentDir, "manifest.json");

      let manifestRaw: string;
      try {
        manifestRaw = await readFile(manifestPath, "utf-8");
      } catch {
        console.warn(`Skipping ${componentDir}: no manifest.json`);
        continue;
      }

      const manifest: ComponentManifest = JSON.parse(manifestRaw);

      // Read source files
      const fileContents: Record<string, string> = {};

      if (manifest.sourceDir) {
        // Package: read all .ts files recursively from sourceDir
        const srcDir = join(REPO_ROOT, manifest.sourceDir);
        const exclude = new Set(manifest.exclude ?? []);
        const tsFiles = await readDirRecursive(srcDir);
        for (const relPath of tsFiles) {
          if (exclude.has(relPath)) continue;
          const raw = await readFile(join(srcDir, relPath), "utf-8");
          fileContents[relPath] = rewritePackageImports(raw);
        }
      } else {
        // Regular component: read listed files
        for (const fileName of manifest.files!) {
          fileContents[fileName] = await readFile(join(componentDir, fileName), "utf-8");
        }
      }

      const item = buildRegistryItem(manifest, fileContents);
      allItems.push(item);

      // Write individual item JSON
      const outDir = join(OUTPUT_DIR, typeDir);
      await mkdir(outDir, { recursive: true });

      // Write latest (always overwritten)
      await writeFile(
        join(outDir, `${manifest.name}.json`),
        JSON.stringify(item, null, 2) + "\n"
      );
      console.log(`✓ Built ${typeDir}/${manifest.name}.json`);

      // Write versioned file (immutable — skip if already exists)
      const version = manifest.version ?? "1.0.0";
      const versionedPath = join(outDir, `${manifest.name}@${version}.json`);
      try {
        await access(versionedPath);
        // Already exists, skip
      } catch {
        await writeFile(versionedPath, JSON.stringify(item, null, 2) + "\n");
        console.log(`  + ${typeDir}/${manifest.name}@${version}.json (versioned)`);
      }

      // Collect available versions by scanning existing @version files
      const dirEntries = await readdir(outDir);
      const versions: string[] = [];
      const versionPattern = new RegExp(`^${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(.+)\\.json$`);
      for (const f of dirEntries) {
        const match = f.match(versionPattern);
        if (match) versions.push(match[1]);
      }
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      existingVersions.set(manifest.name, versions);
    }
  }

  // Write registry index
  const index = buildRegistryIndex(allItems, existingVersions);
  await writeFile(join(OUTPUT_DIR, "registry.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`\n✓ Registry index: ${allItems.length} components`);
}
