import { readdir, stat, writeFile, mkdir, access, readFile } from "fs/promises";
import { join, resolve, relative } from "path";
import { typeToDir, type RegistryItem, type RegistryIndex } from "./schema.js";

/** Directories to skip when walking the full tree */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "r",
  "test",
  "tests",
  ".claude",
]);

/** Check whether a file exists */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk a directory tree recursively, collecting directories that contain registry.json.
 * Skips directories in the SKIP_DIRS set.
 */
async function walkForRegistryJson(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  // Check if this directory itself has registry.json
  if (await fileExists(join(dir, "registry.json"))) {
    results.push(dir);
    // Don't recurse into component directories — they won't nest further
    return results;
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      const subResults = await walkForRegistryJson(join(dir, entry.name));
      results.push(...subResults);
    }
  }

  return results;
}

/**
 * Discover directories containing registry.json files.
 *
 * If `paths` is provided, each path is checked:
 * - If it directly contains registry.json, it's included.
 * - Otherwise, its immediate subdirectories are checked for registry.json.
 *
 * If `paths` is not provided, the full directory tree from `cwd` is walked,
 * skipping directories in SKIP_DIRS.
 *
 * @returns Array of absolute directory paths containing registry.json.
 */
export async function scanForComponents(
  cwd: string,
  paths?: string[]
): Promise<string[]> {
  const resolvedCwd = resolve(cwd);

  if (paths && paths.length > 0) {
    const results: string[] = [];

    for (const p of paths) {
      const absPath = resolve(resolvedCwd, p);

      // Check if this path directly contains registry.json
      if (await fileExists(join(absPath, "registry.json"))) {
        results.push(absPath);
        continue;
      }

      // Otherwise, scan one level of subdirectories
      let entries;
      try {
        entries = await readdir(absPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = join(absPath, entry.name);
          if (await fileExists(join(subDir, "registry.json"))) {
            results.push(subDir);
          }
        }
      }
    }

    return results;
  }

  // No paths specified — walk the full tree
  return walkForRegistryJson(resolvedCwd);
}

/**
 * Extract version strings from versioned filenames like `weather@1.0.0.json`.
 */
function parseVersionFromFilename(
  name: string,
  componentName: string
): string | null {
  const prefix = `${componentName}@`;
  const suffix = ".json";
  if (name.startsWith(prefix) && name.endsWith(suffix)) {
    return name.slice(prefix.length, -suffix.length);
  }
  return null;
}

/**
 * Write the built registry output to the output directory.
 *
 * For each item:
 * 1. Creates the type subdirectory (e.g., tools/, package/)
 * 2. Writes `<typeDir>/<name>.json` — latest version, always overwritten
 * 3. Writes `<typeDir>/<name>@<version>.json` — versioned copy, immutable (skipped if exists)
 * 4. Scans existing versioned files to collect all available versions
 *
 * After all items:
 * 5. Writes `registry.json` index with metadata (no file content)
 *
 * @returns `{ written, skipped }` arrays of relative file paths.
 */
export async function writeRegistryOutput(
  outputDir: string,
  items: RegistryItem[]
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  const resolvedOutput = resolve(outputDir);

  const indexItems: RegistryIndex["items"] = [];

  for (const item of items) {
    const dir = typeToDir[item.type];
    const typeDir = join(resolvedOutput, dir);
    await mkdir(typeDir, { recursive: true });

    const itemJson = JSON.stringify(item, null, 2);

    // 1. Write latest version (always overwritten)
    const latestPath = join(typeDir, `${item.name}.json`);
    const latestRelative = `${dir}/${item.name}.json`;
    await writeFile(latestPath, itemJson, "utf-8");
    written.push(latestRelative);

    // 2. Write versioned copy (immutable)
    if (item.version) {
      const versionedFilename = `${item.name}@${item.version}.json`;
      const versionedPath = join(typeDir, versionedFilename);
      const versionedRelative = `${dir}/${versionedFilename}`;

      if (await fileExists(versionedPath)) {
        skipped.push(versionedRelative);
      } else {
        await writeFile(versionedPath, itemJson, "utf-8");
        written.push(versionedRelative);
      }
    }

    // 3. Scan for all versioned files to collect versions
    const versions: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(typeDir);
    } catch {
      entries = [];
    }

    for (const filename of entries) {
      const ver = parseVersionFromFilename(filename, item.name);
      if (ver) {
        versions.push(ver);
      }
    }

    // Sort versions (simple string sort is fine for semver with consistent formatting)
    versions.sort();

    // 4. Build index item (no file content)
    indexItems.push({
      name: item.name,
      type: item.type,
      description: item.description,
      ...(item.registryDependencies &&
        item.registryDependencies.length > 0 && {
          registryDependencies: item.registryDependencies,
        }),
      ...(item.categories &&
        item.categories.length > 0 && { categories: item.categories }),
      ...(item.version && { version: item.version }),
      ...(versions.length > 0 && { versions }),
      ...(item.updatedAt && { updatedAt: item.updatedAt }),
    });
  }

  // 5. Write registry.json index
  const index: RegistryIndex = {
    version: "1",
    items: indexItems,
  };

  const indexPath = join(resolvedOutput, "registry.json");
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  written.push("registry.json");

  return { written, skipped };
}
