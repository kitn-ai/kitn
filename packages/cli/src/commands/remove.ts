import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import { unlink } from "fs/promises";
import { readConfig, writeConfig } from "../utils/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";

export async function removeCommand(componentName: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // Resolve "routes" alias to framework-specific package name
  const input = componentName === "routes" ? (config.framework ?? "hono") : componentName;
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

  delete config.installed![installedKey];
  if (Object.keys(config.installed!).length === 0) {
    delete config.installed;
  }
  await writeConfig(cwd, config);

  if (deleted.length > 0) {
    p.log.success(`Removed ${ref.name}:`);
    for (const f of deleted) p.log.message(`  ${pc.red("-")} ${f}`);
  }
}
