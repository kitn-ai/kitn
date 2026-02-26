import { readFile, readdir } from "fs/promises";
import { join, relative } from "path";
import {
  componentConfigSchema,
  registryItemSchema,
  typeToDir,
  type ComponentConfig,
  type RegistryItem,
} from "./schema.js";

/** Build tooling devDependencies to exclude from the output */
const EXCLUDED_DEV_DEPS = new Set([
  "typescript",
  "@types/bun",
  "@types/node",
  "tsup",
  "vitest",
  "jest",
  "@types/jest",
]);

function isExcludedDevDep(name: string): boolean {
  return EXCLUDED_DEV_DEPS.has(name) || name.startsWith("@types/");
}

/** Strip @scope/ prefix from a package name (e.g., @kitnai/core -> core) */
function stripScope(name: string): string {
  const match = name.match(/^@[^/]+\/(.+)$/);
  return match ? match[1] : name;
}

/** Recursively read all .ts files from a directory */
async function readTsFiles(
  dir: string,
  baseDir: string,
  exclude: string[]
): Promise<{ relativePath: string; content: string }[]> {
  const results: { relativePath: string; content: string }[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      const nested = await readTsFiles(fullPath, baseDir, exclude);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      if (exclude.includes(relPath)) {
        continue;
      }
      const content = await readFile(fullPath, "utf-8");
      results.push({ relativePath: relPath, content });
    }
  }

  return results;
}

/**
 * Build a RegistryItem from a component directory.
 *
 * Reads registry.json (required) + optional package.json + source files,
 * and produces a validated RegistryItem.
 */
export async function buildComponent(componentDir: string): Promise<RegistryItem> {
  // 1. Read and validate registry.json
  let rawConfig: string;
  try {
    rawConfig = await readFile(join(componentDir, "registry.json"), "utf-8");
  } catch {
    throw new Error(
      `No registry.json found in ${componentDir}. Every component must have a registry.json file.`
    );
  }

  let config: ComponentConfig;
  try {
    config = componentConfigSchema.parse(JSON.parse(rawConfig));
  } catch (err) {
    throw new Error(
      `Invalid registry.json in ${componentDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2. Try to read package.json (optional)
  let pkg: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null = null;

  try {
    const rawPkg = await readFile(join(componentDir, "package.json"), "utf-8");
    pkg = JSON.parse(rawPkg);
  } catch {
    // No package.json, that's fine for standalone components
  }

  // 3. Resolve metadata by merging registry.json + package.json
  const name = config.name ?? (pkg?.name ? stripScope(pkg.name) : undefined);
  const version = config.version ?? pkg?.version;
  const description = config.description ?? pkg?.description;

  if (!name) {
    throw new Error(
      `Component in ${componentDir} is missing a name. Provide "name" in registry.json or have a package.json with a "name" field.`
    );
  }
  if (!description) {
    throw new Error(
      `Component in ${componentDir} is missing a description. Provide "description" in registry.json or have a package.json with a "description" field.`
    );
  }

  // Resolve dependencies from package.json if available
  let dependencies = config.dependencies;
  let devDependencies = config.devDependencies;

  if (pkg && !config.dependencies) {
    const deps: string[] = [];
    if (pkg.dependencies) {
      for (const [depName, depVersion] of Object.entries(pkg.dependencies)) {
        if (depVersion !== "workspace:*") {
          deps.push(depName);
        }
      }
    }
    if (pkg.peerDependencies) {
      for (const [depName, depVersion] of Object.entries(pkg.peerDependencies)) {
        if (depVersion !== "workspace:*") {
          deps.push(depName);
        }
      }
    }
    if (deps.length > 0) {
      dependencies = deps;
    }
  }

  if (pkg && !config.devDependencies) {
    const devDeps: string[] = [];
    if (pkg.devDependencies) {
      for (const depName of Object.keys(pkg.devDependencies)) {
        if (!isExcludedDevDep(depName)) {
          devDeps.push(depName);
        }
      }
    }
    if (devDeps.length > 0) {
      devDependencies = devDeps;
    }
  }

  // 4. Read source files
  const isPackage = config.type === "kitn:package";
  const dirPrefix = config.installDir ?? typeToDir[config.type];

  let files: { path: string; content: string; type: typeof config.type }[];

  if (isPackage) {
    // For packages: recursively read .ts files from src/ (or sourceDir override)
    const sourceDir = config.sourceDir ?? "src";
    const sourcePath = join(componentDir, sourceDir);
    const exclude = config.exclude ?? [];

    let tsFiles: { relativePath: string; content: string }[];
    try {
      tsFiles = await readTsFiles(sourcePath, sourcePath, exclude);
    } catch {
      throw new Error(
        `Cannot read source directory "${sourceDir}" in ${componentDir}. Make sure it exists.`
      );
    }

    files = tsFiles.map((f) => ({
      path: `${dirPrefix}/${f.relativePath}`,
      content: f.content,
      type: config.type,
    }));
  } else {
    // For standalone components: read files listed in the files array
    if (!config.files || config.files.length === 0) {
      throw new Error(
        `Component "${name}" (type: ${config.type}) has no "files" array in registry.json. Standalone components must list their source files.`
      );
    }

    files = await Promise.all(
      config.files.map(async (filePath) => {
        const fullPath = join(componentDir, filePath);
        let content: string;
        try {
          content = await readFile(fullPath, "utf-8");
        } catch {
          throw new Error(
            `Cannot read file "${filePath}" referenced in registry.json for component "${name}". Make sure the file exists at ${fullPath}.`
          );
        }
        return {
          path: `${dirPrefix}/${filePath}`,
          content,
          type: config.type,
        };
      })
    );
  }

  // 5. Build the RegistryItem
  const item: RegistryItem = {
    name,
    type: config.type,
    description,
    files,
  };

  // Add optional fields only if present
  if (version) item.version = version;
  if (dependencies && dependencies.length > 0) item.dependencies = dependencies;
  if (devDependencies && devDependencies.length > 0) item.devDependencies = devDependencies;
  if (config.registryDependencies && config.registryDependencies.length > 0) {
    item.registryDependencies = config.registryDependencies;
  }
  if (config.envVars) item.envVars = config.envVars;
  if (config.tsconfig) item.tsconfig = config.tsconfig;
  if (config.docs) item.docs = config.docs;
  if (config.categories && config.categories.length > 0) item.categories = config.categories;
  if (config.changelog && config.changelog.length > 0) item.changelog = config.changelog;
  if (isPackage && config.installDir) item.installDir = config.installDir;

  // 6. Validate the result
  try {
    return registryItemSchema.parse(item);
  } catch (err) {
    throw new Error(
      `Built component "${name}" failed validation: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
