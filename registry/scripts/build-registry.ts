import { registryItemSchema, typeToAliasKey } from "../src/schema.js";
import type { RegistryItem, RegistryIndex, ComponentType } from "../src/schema.js";

interface ComponentManifest {
  name: string;
  type: ComponentType;
  description: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  envVars?: Record<string, string>;
  files: string[];
  docs?: string;
  categories?: string[];
  version?: string;
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

  const files = manifest.files.map((fileName) => ({
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
  });
}

export function buildRegistryIndex(items: RegistryItem[]): RegistryIndex {
  return {
    $schema: "https://kitn.dev/schema/registry.json",
    version: "1.0.0",
    items: items.map(({ name, type, description, registryDependencies, categories, version }) => ({
      name,
      type,
      description,
      registryDependencies,
      categories,
      version,
    })),
  };
}

// CLI entry point — run with `bun run scripts/build-registry.ts`
if (import.meta.main) {
  const { readdir, readFile, writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");

  const ROOT = new URL("..", import.meta.url).pathname;
  const COMPONENTS_DIR = join(ROOT, "components");
  const OUTPUT_DIR = join(ROOT, "r");

  const allItems: RegistryItem[] = [];

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

      // Read all source files listed in manifest
      const fileContents: Record<string, string> = {};
      for (const fileName of manifest.files) {
        fileContents[fileName] = await readFile(join(componentDir, fileName), "utf-8");
      }

      const item = buildRegistryItem(manifest, fileContents);
      allItems.push(item);

      // Write individual item JSON
      const outDir = join(OUTPUT_DIR, typeDir);
      await mkdir(outDir, { recursive: true });
      await writeFile(
        join(outDir, `${manifest.name}.json`),
        JSON.stringify(item, null, 2) + "\n"
      );
      console.log(`✓ Built ${typeDir}/${manifest.name}.json`);
    }
  }

  // Write registry index
  const index = buildRegistryIndex(allItems);
  await writeFile(join(OUTPUT_DIR, "registry.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`\n✓ Registry index: ${allItems.length} components`);
}
