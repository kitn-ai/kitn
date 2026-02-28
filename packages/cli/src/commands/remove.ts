import * as p from "@clack/prompts";
import pc from "picocolors";
import { join, relative, dirname } from "path";
import { unlink, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { readConfig, writeConfig, resolveRoutesAlias, readLock, writeLock } from "../utils/config.js";
import type { LockFile } from "../utils/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { removeImportFromBarrel } from "../installers/barrel-manager.js";

async function removeSingleComponent(installedKey: string, lock: LockFile, config: any, cwd: string) {
  const entry = lock[installedKey];
  if (!entry) return;

  const deleted: string[] = [];
  for (const filePath of entry.files) {
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

  delete lock[installedKey];

  if (deleted.length > 0) {
    p.log.success(`Removed ${installedKey}:\n` + deleted.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
  }
}

async function offerOrphanRemoval(removedDeps: Set<string>, lock: LockFile, config: any, cwd: string) {
  if (removedDeps.size === 0) return;

  // Find orphaned dependencies — deps not needed by any remaining installed component
  const remaining = Object.entries(lock);
  const neededDeps = new Set<string>();
  for (const [, entry] of remaining) {
    if (entry.registryDependencies) {
      for (const dep of entry.registryDependencies) {
        neededDeps.add(dep);
      }
    }
  }

  // Also exclude "core" — never offer to remove it
  const orphans = [...removedDeps].filter(
    (dep) => dep !== "core" && !neededDeps.has(dep) && lock[dep]
  );

  if (orphans.length === 0) return;

  const selected = await p.multiselect({
    message: "The following dependencies are no longer used. Remove them?",
    options: orphans.map((dep) => ({
      value: dep,
      label: dep,
      hint: `${lock[dep].files.length} file(s)`,
    })),
    initialValues: orphans, // all checked by default
  });

  if (p.isCancel(selected)) return;

  for (const key of selected as string[]) {
    await removeSingleComponent(key, lock, config, cwd);
  }
}

export async function removeCommand(componentName?: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const lock = await readLock(cwd);

  if (!componentName) {
    const installedKeys = Object.keys(lock);

    if (installedKeys.length === 0) {
      p.log.warn("No components installed.");
      process.exit(0);
    }

    const selected = await p.multiselect({
      message: "Select components to remove:",
      options: installedKeys.map((key) => ({
        value: key,
        label: key,
        hint: `${lock[key].files.length} file(s)`,
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

    // Snapshot deps before removal (entries get deleted during removeSingleComponent)
    const allRemovedDeps = new Set<string>();
    for (const key of selectedKeys) {
      const entry = lock[key];
      if (entry?.registryDependencies) {
        for (const dep of entry.registryDependencies) {
          allRemovedDeps.add(dep);
        }
      }
    }

    // Remove each selected component
    for (const key of selectedKeys) {
      await removeSingleComponent(key, lock, config, cwd);
    }

    await offerOrphanRemoval(allRemovedDeps, lock, config, cwd);

    await writeLock(cwd, lock);
    p.outro(pc.green("Done!"));
    return;
  }

  // Resolve "routes" alias to framework-specific adapter name
  const input = componentName === "routes" ? resolveRoutesAlias(config) : componentName;
  const ref = parseComponentRef(input);

  // Look up in lock — @kitn uses plain name, third-party uses @namespace/name
  const installedKey = ref.namespace === "@kitn" ? ref.name : `${ref.namespace}/${ref.name}`;
  const entry = lock[installedKey];
  if (!entry) {
    p.log.error(`Component '${ref.name}' is not installed.`);
    process.exit(1);
  }

  const shouldRemove = await p.confirm({
    message: `Remove ${ref.name}? This will delete ${entry.files.length} file(s).`,
    initialValue: false,
  });
  if (p.isCancel(shouldRemove) || !shouldRemove) {
    p.cancel("Remove cancelled.");
    process.exit(0);
  }

  // Snapshot deps before removal
  const removedDeps = new Set(entry.registryDependencies ?? []);

  await removeSingleComponent(installedKey, lock, config, cwd);

  // Check for orphaned dependencies
  await offerOrphanRemoval(removedDeps, lock, config, cwd);

  await writeLock(cwd, lock);
}
