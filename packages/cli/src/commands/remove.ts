import * as p from "@clack/prompts";
import pc from "picocolors";
import { join, relative, dirname } from "path";
import { unlink, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { readConfig, writeConfig, resolveRoutesAlias } from "../utils/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { removeImportFromBarrel } from "../installers/barrel-manager.js";

export async function removeCommand(componentName: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // Resolve "routes" alias to framework-specific adapter name
  const input = componentName === "routes" ? resolveRoutesAlias(config) : componentName;
  const ref = parseComponentRef(input);

  // Look up in installed — @kitn uses plain name, third-party uses @namespace/name
  const installedKey = ref.namespace === "@kitn" ? ref.name : `${ref.namespace}/${ref.name}`;
  const installed = config.installed?.[installedKey];
  if (!installed) {
    p.log.error(`Component '${ref.name}' is not installed.`);
    process.exit(1);
  }

  const shouldRemove = await p.confirm({
    message: `Remove ${ref.name}? This will delete ${installed.files.length} file(s).`,
    initialValue: false,
  });
  if (p.isCancel(shouldRemove) || !shouldRemove) {
    p.cancel("Remove cancelled.");
    process.exit(0);
  }

  const deleted: string[] = [];
  for (const filePath of installed.files) {
    try {
      await unlink(join(cwd, filePath));
      deleted.push(filePath);
    } catch {
      p.log.warn(`Could not delete ${filePath} (may have been moved or renamed)`);
    }
  }

  // Remove barrel imports for deleted files
  const baseDir = config.aliases.base ?? "src/ai";
  const barrelPath = join(cwd, baseDir, "index.ts");
  const barrelDir = join(cwd, baseDir);
  const barrelEligibleDirs = new Set([
    config.aliases.agents,
    config.aliases.tools,
    config.aliases.skills,
  ]);

  if (existsSync(barrelPath) && deleted.length > 0) {
    let barrelContent = await readFile(barrelPath, "utf-8");
    let barrelChanged = false;

    for (const filePath of deleted) {
      // Check if the file is in a barrel-eligible directory
      const fileDir = dirname(filePath);
      if (!barrelEligibleDirs.has(fileDir)) continue;

      const importPath = "./" + relative(barrelDir, join(cwd, filePath)).replace(/\\/g, "/");
      const updated = removeImportFromBarrel(barrelContent, importPath);
      if (updated !== barrelContent) {
        barrelContent = updated;
        barrelChanged = true;
      }
    }

    if (barrelChanged) {
      await writeFile(barrelPath, barrelContent);
      p.log.info(`Updated barrel file: ${join(baseDir, "index.ts")}`);
    }
  }

  delete config.installed![installedKey];
  if (Object.keys(config.installed!).length === 0) {
    delete config.installed;
  }
  await writeConfig(cwd, config);

  if (deleted.length > 0) {
    p.log.success(`Removed ${ref.name}:\n` + deleted.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
  }
}
