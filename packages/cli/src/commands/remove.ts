import * as p from "@clack/prompts";
import pc from "picocolors";
import { join, relative, dirname } from "path";
import { unlink, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { readConfig, writeConfig, resolveRoutesAlias } from "../utils/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { removeImportFromBarrel } from "../installers/barrel-manager.js";

async function removeSingleComponent(installedKey: string, config: any, cwd: string) {
  const installed = config.installed?.[installedKey];
  if (!installed) return;

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

  if (deleted.length > 0) {
    p.log.success(`Removed ${installedKey}:\n` + deleted.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
  }
}

async function offerOrphanRemoval(removedDeps: Set<string>, config: any, cwd: string) {
  if (removedDeps.size === 0) return;

  // Find orphaned dependencies — deps not needed by any remaining installed component
  const remaining = Object.entries(config.installed ?? {});
  const neededDeps = new Set<string>();
  for (const [, entry] of remaining) {
    const deps = (entry as any).registryDependencies as string[] | undefined;
    if (deps) {
      for (const dep of deps) {
        neededDeps.add(dep);
      }
    }
  }

  // Also exclude "core" — never offer to remove it
  const orphans = [...removedDeps].filter(
    (dep) => dep !== "core" && !neededDeps.has(dep) && config.installed?.[dep]
  );

  if (orphans.length === 0) return;

  const selected = await p.multiselect({
    message: "The following dependencies are no longer used. Remove them?",
    options: orphans.map((dep) => ({
      value: dep,
      label: dep,
      hint: `${config.installed![dep].files.length} file(s)`,
    })),
    initialValues: orphans, // all checked by default
  });

  if (p.isCancel(selected)) return;

  for (const key of selected as string[]) {
    await removeSingleComponent(key, config, cwd);
  }
}

export async function removeCommand(componentName?: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  if (!componentName) {
    const installed = config.installed ?? {};
    const installedKeys = Object.keys(installed);

    if (installedKeys.length === 0) {
      p.log.warn("No components installed.");
      process.exit(0);
    }

    const selected = await p.multiselect({
      message: "Select components to remove:",
      options: installedKeys.map((key) => ({
        value: key,
        label: key,
        hint: `${installed[key].files.length} file(s)`,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const selectedKeys = selected as string[];
    if (selectedKeys.length === 0) {
      p.log.warn("No components selected.");
      process.exit(0);
    }

    // Remove each selected component
    for (const key of selectedKeys) {
      await removeSingleComponent(key, config, cwd);
    }

    // Compute orphaned dependencies across all removals
    const allRemovedDeps = new Set<string>();
    for (const key of selectedKeys) {
      const entry = installed[key];
      if (entry?.registryDependencies) {
        for (const dep of entry.registryDependencies) {
          allRemovedDeps.add(dep);
        }
      }
    }

    await offerOrphanRemoval(allRemovedDeps, config, cwd);

    await writeConfig(cwd, config);
    p.outro(pc.green("Done!"));
    return;
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

  await removeSingleComponent(installedKey, config, cwd);

  // Check for orphaned dependencies
  const removedDeps = new Set(installed.registryDependencies ?? []);
  await offerOrphanRemoval(removedDeps, config, cwd);

  if (Object.keys(config.installed!).length === 0) {
    delete config.installed;
  }
  await writeConfig(cwd, config);
}
