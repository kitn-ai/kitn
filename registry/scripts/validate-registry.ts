/**
 * Validates that all registry component imports resolve correctly
 * in the installed layout (src/agents/, src/tools/, etc.).
 *
 * Run: bun run validate
 *
 * This catches the #1 contributor mistake: writing import paths that
 * work in the registry directory structure but not after `kitn add`.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname, resolve, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const COMPONENTS_DIR = join(ROOT, "components");

interface ComponentManifest {
  name: string;
  type: "kitn:agent" | "kitn:tool" | "kitn:skill" | "kitn:storage";
  files: string[];
  registryDependencies?: string[];
}

const typeToDir: Record<string, string> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
};

// Extract relative import paths from a TypeScript source file.
// Matches: import ... from "./path" and export ... from "./path"
function extractRelativeImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:import|export)\s+.*?\s+from\s+["'](\.[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

// Given a .js import specifier, find the corresponding .ts file path
// e.g. "../tools/weather.js" → "tools/weather.ts"
function resolveImportToFile(
  importPath: string,
  fromFileInstalledPath: string,
): string {
  const fromDir = dirname(fromFileInstalledPath);
  let resolved = resolve("/", fromDir, importPath);
  // Strip leading /
  resolved = resolved.slice(1);
  // Replace .js extension with .ts for resolution
  if (resolved.endsWith(".js")) {
    resolved = resolved.slice(0, -3) + ".ts";
  }
  return resolved;
}

async function main() {
  // Phase 1: Build the installed layout map
  // Maps installed path (e.g. "agents/weather-agent.ts") → component name
  const installedFiles = new Map<string, string>();
  // Maps component name → manifest
  const manifests = new Map<string, ComponentManifest>();
  // Maps installed path → source content
  const fileContents = new Map<string, string>();

  for (const typeDir of ["agents", "tools", "skills", "storage"]) {
    const dir = join(COMPONENTS_DIR, typeDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = join(dir, entry, "manifest.json");
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(manifestPath, "utf-8");
      } catch {
        continue;
      }

      const manifest: ComponentManifest = JSON.parse(manifestRaw);
      manifests.set(manifest.name, manifest);
      const installDir = typeToDir[manifest.type];

      for (const fileName of manifest.files) {
        const installedPath = `${installDir}/${fileName}`;
        installedFiles.set(installedPath, manifest.name);

        const source = await readFile(join(dir, entry, fileName), "utf-8");
        fileContents.set(installedPath, source);
      }
    }
  }

  // Phase 2: Validate imports
  let errors = 0;
  let filesChecked = 0;
  let importsChecked = 0;

  for (const [installedPath, componentName] of installedFiles) {
    // Skip non-TypeScript files (skills are .md)
    if (extname(installedPath) !== ".ts") continue;

    const source = fileContents.get(installedPath)!;
    const imports = extractRelativeImports(source);
    filesChecked++;

    for (const importPath of imports) {
      importsChecked++;
      const resolvedTarget = resolveImportToFile(importPath, installedPath);

      if (!installedFiles.has(resolvedTarget)) {
        errors++;
        console.error(
          `\x1b[31m✗\x1b[0m ${componentName} → ${installedPath}`,
        );
        console.error(
          `  import "${importPath}" resolves to "${resolvedTarget}" which is not in the registry`,
        );

        // Suggest the correct component if we can find a partial match
        const fileName = resolvedTarget.split("/").pop()!;
        const candidates = [...installedFiles.entries()].filter(([path]) =>
          path.endsWith(fileName),
        );
        if (candidates.length > 0) {
          for (const [candidatePath, candidateName] of candidates) {
            console.error(
              `  \x1b[33mhint\x1b[0m: did you mean "${candidatePath}" from component "${candidateName}"?`,
            );

            // Check if the component is declared as a registryDependency
            const manifest = manifests.get(componentName)!;
            const deps = manifest.registryDependencies ?? [];
            if (!deps.includes(candidateName)) {
              console.error(
                `  \x1b[33mhint\x1b[0m: "${candidateName}" is not in registryDependencies — add it to manifest.json`,
              );
            }
          }
        }
        console.error();
      }
    }
  }

  // Phase 3: Validate registryDependencies point to real components
  for (const [name, manifest] of manifests) {
    for (const dep of manifest.registryDependencies ?? []) {
      if (!manifests.has(dep)) {
        errors++;
        console.error(
          `\x1b[31m✗\x1b[0m ${name}: registryDependency "${dep}" does not exist in the registry`,
        );
      }
    }
  }

  // Summary
  console.log(
    `\nValidated ${filesChecked} files, ${importsChecked} imports, ${manifests.size} components`,
  );

  if (errors > 0) {
    console.error(`\n\x1b[31m✗ ${errors} error(s) found\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m✓ All imports resolve correctly in the installed layout\x1b[0m`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
