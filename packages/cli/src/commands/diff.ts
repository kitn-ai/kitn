import * as p from "@clack/prompts";
import pc from "picocolors";
import { diffComponent } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function diffCommand(componentName: string) {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await diffComponent({ component: componentName, cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  for (const file of result.files) {
    switch (file.status) {
      case "missing":
        p.log.warn(`${file.path}: file missing locally`);
        break;
      case "changed":
        console.log(file.diff);
        break;
      case "identical":
        // No output for identical files
        break;
    }
  }

  if (!result.hasDifferences) {
    p.log.success(`${result.component}: up to date, no differences.`);
  }
}
