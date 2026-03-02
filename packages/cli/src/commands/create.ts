import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  createComponent,
  componentFileExists,
  type CreateComponentResult,
} from "@kitnai/cli-core";

// Re-export for backward compatibility (used by chat-engine.ts, plan-view.tsx)
export { componentFileExists } from "@kitnai/cli-core";

/**
 * Backward-compatible wrapper around cli-core's `createComponent`.
 * Used by chat-engine.ts for programmatic creation.
 */
export async function createComponentInProject(
  type: string,
  name: string,
  opts?: { cwd?: string; overwrite?: boolean },
): Promise<{ filePath: string; barrelUpdated: boolean }> {
  const result = await createComponent({
    type,
    name,
    cwd: opts?.cwd ?? process.cwd(),
    overwrite: opts?.overwrite,
  });

  if (result.alreadyExists) {
    throw new Error(`Skipped — ${result.filePath} already exists.`);
  }

  return { filePath: result.filePath, barrelUpdated: result.barrelUpdated };
}

export async function createCommand(type: string, name: string) {
  p.intro(pc.bgCyan(pc.black(" kitn create ")));

  try {
    const result = await createComponent({
      type,
      name,
      cwd: process.cwd(),
    });

    if (result.alreadyExists) {
      const shouldOverwrite = await p.confirm({
        message: `${pc.yellow("File already exists:")} ${result.filePath}\n  Overwrite it with a fresh scaffold?`,
      });
      if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
        p.log.error(`Skipped — ${result.filePath} already exists.`);
        process.exit(1);
      }
      // Re-run with overwrite
      const overwriteResult = await createComponent({
        type,
        name,
        cwd: process.cwd(),
        overwrite: true,
      });
      logSuccess(type, name, overwriteResult);
    } else {
      logSuccess(type, name, result);
    }
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}

function logSuccess(
  type: string,
  name: string,
  result: CreateComponentResult,
) {
  p.log.success(`Created ${pc.bold(type)} component ${pc.cyan(name)}`);
  p.log.message(`  ${pc.green("+")} ${result.filePath}`);

  if (result.barrelUpdated) {
    p.log.message(`  ${pc.green("+")} barrel file updated`);
  }

  p.outro(`Edit ${pc.cyan(result.filePath)} to customize your ${type}.`);
}
