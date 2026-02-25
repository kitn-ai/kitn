import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import { unlink } from "fs/promises";
import { readConfig, writeConfig } from "../utils/config.js";

export async function removeCommand(componentName: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // Resolve "routes" alias to framework-specific package name
  const resolvedName =
    componentName === "routes" ? (config.framework ?? "hono") : componentName;

  const installed = config._installed?.[resolvedName];
  if (!installed) {
    p.log.error(`Component '${resolvedName}' is not installed.`);
    process.exit(1);
  }

  const shouldRemove = await p.confirm({
    message: `Remove ${resolvedName}? This will delete ${installed.files.length} file(s).`,
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

  delete config._installed![resolvedName];
  if (Object.keys(config._installed!).length === 0) {
    delete config._installed;
  }
  await writeConfig(cwd, config);

  if (deleted.length > 0) {
    p.log.success(`Removed ${resolvedName}:`);
    for (const f of deleted) p.log.message(`  ${pc.red("-")} ${f}`);
  }
}
