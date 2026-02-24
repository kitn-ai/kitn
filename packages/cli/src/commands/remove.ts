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

  const installed = config._installed?.[componentName];
  if (!installed) {
    p.log.error(`Component '${componentName}' is not installed.`);
    process.exit(1);
  }

  const shouldRemove = await p.confirm({
    message: `Remove ${componentName}? This will delete ${installed.files.length} file(s).`,
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

  delete config._installed![componentName];
  if (Object.keys(config._installed!).length === 0) {
    delete config._installed;
  }
  await writeConfig(cwd, config);

  if (deleted.length > 0) {
    p.log.success(`Removed ${componentName}:`);
    for (const f of deleted) p.log.message(`  ${pc.red("-")} ${f}`);
  }
}
