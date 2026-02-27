import { registryItemSchema } from "../src/schema.js";
import type { RegistryItem, RegistryIndex, ComponentType, ChangelogEntry } from "../src/schema.js";

interface ComponentManifest {
  name: string;
  type: ComponentType;
  description: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  envVars?: Record<string, string>;
  files?: string[];
  installDir?: string;
  tsconfig?: Record<string, string[]>;
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
};

export function buildRegistryItem(
  manifest: ComponentManifest,
  fileContents: Record<string, string>
): RegistryItem {
  const dir = typeToDir[manifest.type];
  const files = manifest.files!.map((fileName) => ({
    path: `${dir}/${fileName}`,
    content: fileContents[fileName] ?? "",
    type: manifest.type,
  }));

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
    items: items.map(({ name, type, description, registryDependencies, categories, version, updatedAt }) => ({
      name,
      type,
      description,
      registryDependencies,
      categories,
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
  const COMPONENTS_DIR = join(ROOT, "components");
  const OUTPUT_DIR = join(ROOT, "r");

  const allItems: RegistryItem[] = [];
  const existingVersions = new Map<string, string[]>();

  for (const typeDir of ["agents", "tools", "skills", "storage"]) {
    const dir = join(COMPONENTS_DIR, typeDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const componentDir = join(dir, entry);
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
      for (const fileName of manifest.files!) {
        fileContents[fileName] = await readFile(join(componentDir, fileName), "utf-8");
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
