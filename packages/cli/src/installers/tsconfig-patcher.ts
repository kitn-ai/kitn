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
