import * as p from "@clack/prompts";
import pc from "picocolors";
import { installFromLock } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";
import { detectPackageManager } from "../utils/detect.js";
import { installDependencies, installDevDependencies } from "../installers/dep-installer.js";

interface InstallOptions {
  frozen?: boolean;
}

export async function installCommand(opts: InstallOptions) {
  p.intro(pc.bgCyan(pc.black(" kitn install ")));

  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const s = p.spinner();
  s.start("Installing components from kitn.lock...");

  let result;
  try {
    result = await installFromLock({ cwd, frozen: opts.frozen });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  const totalInstalled = result.installed.length;
  const totalSkipped = result.skipped.length;
  s.stop(`Processed ${totalInstalled + totalSkipped} component(s)`);

  // Display installed
  if (result.installed.length > 0) {
    p.log.success(
      `Installed ${result.installed.length} component(s):\n` +
        result.installed.map((c) => `  ${pc.green("+")} ${c.name} (${c.files.length} file${c.files.length === 1 ? "" : "s"})`).join("\n"),
    );
  }

  // Display skipped
  if (result.skipped.length > 0) {
    p.log.info(
      `Skipped ${result.skipped.length} component(s) (already up to date):\n` +
        result.skipped.map((c) => `  ${pc.dim("-")} ${c.name}`).join("\n"),
    );
  }

  // Display errors
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      p.log.warn(`${pc.bold(err.component)}: ${err.error}`);
    }
  }

  // Install npm dependencies if needed
  const totalDeps = result.npmDeps.length + result.npmDevDeps.length;
  if (totalDeps > 0) {
    const pm = await detectPackageManager(cwd);
    if (pm) {
      const depSpinner = p.spinner();
      depSpinner.start(`Installing ${totalDeps} npm dependenc${totalDeps === 1 ? "y" : "ies"}...`);
      try {
        if (result.npmDeps.length > 0) installDependencies(pm, result.npmDeps, cwd);
        if (result.npmDevDeps.length > 0) installDevDependencies(pm, result.npmDevDeps, cwd);
        depSpinner.stop("Dependencies installed");
      } catch {
        depSpinner.stop(pc.yellow("Some dependencies failed to install"));
      }
    }
  }

  if (result.errors.length > 0 && opts.frozen) {
    p.outro(pc.red("Install failed (--frozen mode)"));
    process.exit(1);
  }

  p.outro(pc.green("Done!"));
}
