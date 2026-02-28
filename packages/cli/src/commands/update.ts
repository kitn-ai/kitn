import { addCommand } from "./add.js";
import { readConfig, readLock } from "../utils/config.js";
import * as p from "@clack/prompts";

export async function updateCommand(components: string[]) {
  // If no components specified, update all installed components
  if (components.length === 0) {
    const cwd = process.cwd();
    const config = await readConfig(cwd);
    if (!config) {
      p.log.error("No kitn.json found. Run `kitn init` first.");
      process.exit(1);
    }

    const lock = await readLock(cwd);
    if (Object.keys(lock).length === 0) {
      p.log.info("No installed components to update.");
      return;
    }

    components = Object.keys(lock);
  }

  await addCommand(components, { overwrite: true });
}
