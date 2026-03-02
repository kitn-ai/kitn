import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export { patchTsconfig } from "@kitnai/cli-core";
import { patchTsconfig } from "@kitnai/cli-core";

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
