import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  removeComponent,
  removeMultipleComponents,
  removeOrphans,
  readConfig,
  readLock,
  resolveRoutesAlias,
  parseComponentRef,
} from "@kitnai/cli-core";

export async function removeCommand(componentName?: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const lock = await readLock(cwd);

  if (!componentName) {
    // Interactive multi-select mode
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

    let result;
    try {
      result = await removeMultipleComponents({ components: selectedKeys, cwd });
    } catch (err: any) {
      p.log.error(err.message);
      process.exit(1);
    }

    // Display results
    for (const item of result.removed) {
      if (item.files.length > 0) {
        p.log.success(`Removed ${item.name}:\n` + item.files.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
      }
    }

    for (const f of result.failedDeletes) {
      p.log.warn(`Could not delete ${f} (may have been moved or renamed)`);
    }

    if (result.barrelUpdated) {
      const baseDir = config.aliases.base ?? "src/ai";
      p.log.info(`Updated barrel file: ${baseDir}/index.ts`);
    }

    // Offer orphan removal
    if (result.orphans.length > 0) {
      await offerOrphanRemoval(result.orphans, cwd);
    }

    p.outro(pc.green("Done!"));
    return;
  }

  // Single component removal
  const input = componentName === "routes" ? resolveRoutesAlias(config) : componentName;
  const ref = parseComponentRef(input);
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

  let result;
  try {
    result = await removeComponent({ component: componentName, cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  if (result.removed.files.length > 0) {
    p.log.success(`Removed ${result.removed.name}:\n` + result.removed.files.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
  }

  for (const f of result.failedDeletes) {
    p.log.warn(`Could not delete ${f} (may have been moved or renamed)`);
  }

  if (result.barrelUpdated) {
    const baseDir = config.aliases.base ?? "src/ai";
    p.log.info(`Updated barrel file: ${baseDir}/index.ts`);
  }

  // Check for orphaned dependencies
  if (result.orphans.length > 0) {
    await offerOrphanRemoval(result.orphans, cwd);
  }
}

async function offerOrphanRemoval(orphans: string[], cwd: string) {
  const lock = await readLock(cwd);

  const selected = await p.multiselect({
    message: "The following dependencies are no longer used. Remove them?",
    options: orphans.map((dep) => ({
      value: dep,
      label: dep,
      hint: lock[dep] ? `${lock[dep].files.length} file(s)` : undefined,
    })),
    initialValues: orphans,
  });

  if (p.isCancel(selected)) return;

  const selectedKeys = selected as string[];
  if (selectedKeys.length === 0) return;

  try {
    const removed = await removeOrphans(selectedKeys, cwd);
    for (const item of removed) {
      if (item.files.length > 0) {
        p.log.success(`Removed ${item.name}:\n` + item.files.map((f) => `  ${pc.red("-")} ${f}`).join("\n"));
      }
    }
  } catch (err: any) {
    p.log.warn(`Failed to remove some orphans: ${err.message}`);
  }
}
