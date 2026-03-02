import * as p from "@clack/prompts";
import pc from "picocolors";
import { updateComponents } from "@kitnai/cli-core";
import { detectPackageManager } from "../utils/detect.js";
import { installDependencies, installDevDependencies } from "../installers/dep-installer.js";

export async function updateCommand(components: string[]) {
  p.intro(pc.bgCyan(pc.black(" kitn update ")));

  const cwd = process.cwd();

  try {
    const result = await updateComponents({
      components: components.length > 0 ? components : undefined,
      cwd,
    });

    // Display results
    if (result.updated.length > 0) {
      p.log.success(
        `Updated ${result.updated.length} file(s):\n` +
          result.updated.map((f) => `  ${pc.yellow("~")} ${f}`).join("\n"),
      );
    }

    if (result.created.length > 0) {
      p.log.success(
        `Added ${result.created.length} file(s):\n` +
          result.created.map((f) => `  ${pc.green("+")} ${f}`).join("\n"),
      );
    }

    if (result.skipped.length > 0) {
      p.log.info(
        `Skipped ${result.skipped.length} file(s) (no changes):\n` +
          result.skipped.map((f) => `  ${pc.dim("-")} ${f}`).join("\n"),
      );
    }

    // Install npm dependencies if needed
    const totalDeps = result.npmDeps.length + result.npmDevDeps.length;
    if (totalDeps > 0) {
      const pm = await detectPackageManager(cwd);
      if (pm) {
        const s = p.spinner();
        s.start(`Installing ${totalDeps} npm dependenc${totalDeps === 1 ? "y" : "ies"}...`);
        try {
          if (result.npmDeps.length > 0) installDependencies(pm, result.npmDeps, cwd);
          if (result.npmDevDeps.length > 0) installDevDependencies(pm, result.npmDevDeps, cwd);
          s.stop("Dependencies installed");
        } catch {
          s.stop(pc.yellow("Some dependencies failed to install"));
        }
      }
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        p.log.warn(`${pc.bold(err.component)}: ${err.error}`);
      }
    }

    const totalUpdated = result.updated.length + result.created.length;
    if (totalUpdated === 0 && result.errors.length === 0) {
      p.outro("All components are up to date.");
    } else {
      p.outro(pc.green("Done!"));
    }
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}
