import { addCommand } from "./add.js";
import { readConfig } from "../utils/config.js";
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

    const installed = config._installed;
    if (!installed || Object.keys(installed).length === 0) {
      p.log.info("No installed components to update.");
      return;
    }

    components = Object.keys(installed);
  }

  await addCommand(components, { overwrite: true });
}
