import * as p from "@clack/prompts";
import pc from "picocolors";
import { outdatedComponents } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function outdatedCommand() {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const s = p.spinner();
  s.start("Checking for updates...");

  let result;
  try {
    result = await outdatedComponents({ cwd });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Checked ${result.stats.total} component(s)`);

  for (const e of result.errors) {
    p.log.warn(`${pc.yellow("\u26A0")} ${e}`);
  }

  if (result.items.length === 0) {
    p.log.info("No installed components.");
    return;
  }

  // Calculate column widths
  let maxName = "Component".length;
  let maxInstalled = "Installed".length;
  let maxLatest = "Latest".length;
  let maxRegistry = "Registry".length;

  for (const item of result.items) {
    if (item.name.length > maxName) maxName = item.name.length;
    if (item.installedVersion.length > maxInstalled) maxInstalled = item.installedVersion.length;
    if (item.latestVersion.length > maxLatest) maxLatest = item.latestVersion.length;
    if (item.registry.length > maxRegistry) maxRegistry = item.registry.length;
  }

  // Print header
  const header =
    `  ${"Component".padEnd(maxName + 2)}` +
    `${"Installed".padEnd(maxInstalled + 2)}` +
    `${"Latest".padEnd(maxLatest + 2)}` +
    `${"Registry".padEnd(maxRegistry)}`;
  console.log(pc.bold(header));
  console.log(pc.dim("  " + "\u2500".repeat(header.length - 2)));

  // Print rows
  for (const item of result.items) {
    const nameCol = item.name.padEnd(maxName + 2);
    const installedCol = item.installedVersion.padEnd(maxInstalled + 2);
    const latestCol = item.latestVersion.padEnd(maxLatest + 2);
    const registryCol = item.registry.padEnd(maxRegistry);

    if (item.isOutdated) {
      console.log(
        `  ${pc.yellow(nameCol)}${pc.red(installedCol)}${pc.green(latestCol)}${pc.dim(registryCol)}`,
      );
    } else {
      console.log(
        `  ${pc.dim(nameCol)}${pc.dim(installedCol)}${pc.dim(latestCol)}${pc.dim(registryCol)}`,
      );
    }
  }

  console.log();

  if (result.stats.outdated > 0) {
    p.log.warn(
      `${result.stats.outdated} component(s) outdated. Run ${pc.bold("kitn update")} to update.`,
    );
  } else {
    p.log.success("All components are up to date.");
  }
}
