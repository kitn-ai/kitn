import { readFile, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Strip single-line (//) and multi-line comments from JSONC,
 * and remove trailing commas before } or ], so JSON.parse succeeds.
 */
function stripJsonc(text: string): string {
  return text
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

/**
 * Patches a tsconfig JSON string with additional paths entries.
 * If removePrefixes is provided, any existing path keys starting with
 * those prefixes are deleted first (useful for cleaning up old aliases).
 * Returns the updated JSON string.
 */
export function patchTsconfig(
  tsconfigContent: string,
  paths: Record<string, string[]>,
  removePrefixes?: string[],
): string {
  const config = JSON.parse(stripJsonc(tsconfigContent));

  if (!config.compilerOptions) {
    config.compilerOptions = {};
  }
  if (!config.compilerOptions.paths) {
    config.compilerOptions.paths = {};
  }

  if (removePrefixes) {
    for (const key of Object.keys(config.compilerOptions.paths)) {
      if (removePrefixes.some((prefix) => key.startsWith(prefix))) {
        delete config.compilerOptions.paths[key];
      }
    }
  }

  for (const [key, value] of Object.entries(paths)) {
    config.compilerOptions.paths[key] = value;
  }

  // Ensure minimum compiler options for kitn compatibility.
  // target ES2022+: our code uses Set/Map iteration
  // moduleResolution "bundler": resolves node_modules packages and path aliases
  // skipLibCheck: avoids noise from third-party .d.ts files
  const ES_TARGETS = ["es3", "es5", "es6", "es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021"];
  const currentTarget = (config.compilerOptions.target ?? "").toLowerCase();
  if (!currentTarget || ES_TARGETS.includes(currentTarget)) {
    config.compilerOptions.target = "ES2022";
  }
  if (!config.compilerOptions.moduleResolution) {
    config.compilerOptions.moduleResolution = "bundler";
  }
  if (!config.compilerOptions.module) {
    config.compilerOptions.module = "ESNext";
  }
  if (config.compilerOptions.skipLibCheck === undefined) {
    config.compilerOptions.skipLibCheck = true;
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
  removePrefixes?: string[],
): Promise<void> {
  const tsconfigPath = join(projectDir, "tsconfig.json");
  let content: string;
  try {
    content = await readFile(tsconfigPath, "utf-8");
  } catch {
    content = "{}";
  }

  const patched = patchTsconfig(content, paths, removePrefixes);
  await writeFile(tsconfigPath, patched);
}
