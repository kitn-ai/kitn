import * as p from "@clack/prompts";
import pc from "picocolors";
import { getComponentInfo } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function infoCommand(component: string) {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const s = p.spinner();
  s.start("Fetching component info...");

  let result;
  try {
    result = await getComponentInfo({ component, cwd });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop("Component found");

  const { item, indexItem, namespace, installed, installedVersion, updateAvailable } = result;
  const version = item.version ?? indexItem.version ?? "unknown";
  const typeName = indexItem.type.replace("kitn:", "");

  // Header: name, version, namespace
  console.log();
  console.log(
    `  ${pc.bold(item.name)} ${pc.cyan(`v${version}`)}${" ".repeat(Math.max(1, 40 - item.name.length - version.length - 2))}${pc.dim(namespace)}`
  );
  console.log(`  ${pc.dim(item.description)}`);
  console.log();

  // Details
  console.log(`  ${pc.dim("Type:")}           ${typeName}`);

  if (item.dependencies?.length) {
    console.log(
      `  ${pc.dim("Dependencies:")}   ${item.dependencies.join(", ")}`
    );
  }

  if (item.registryDependencies?.length) {
    console.log(
      `  ${pc.dim("Registry deps:")}  ${item.registryDependencies.join(", ")}`
    );
  }

  if (item.categories?.length) {
    console.log(
      `  ${pc.dim("Categories:")}     ${item.categories.join(", ")}`
    );
  }

  if (item.updatedAt) {
    console.log(`  ${pc.dim("Updated:")}        ${item.updatedAt}`);
  }

  // Available versions from index
  const versions = indexItem.versions;
  if (versions?.length) {
    console.log(`  ${pc.dim("Versions:")}       ${versions.join(", ")}`);
  }

  // Changelog
  if (item.changelog?.length) {
    console.log();
    console.log(`  ${pc.bold("Changelog:")}`);
    for (const entry of item.changelog) {
      const tag =
        entry.type === "feature"
          ? pc.green(entry.type)
          : entry.type === "fix"
            ? pc.yellow(entry.type)
            : entry.type === "breaking"
              ? pc.red(entry.type)
              : pc.dim(entry.type);
      console.log(
        `    ${pc.cyan(entry.version)}  ${pc.dim(entry.date)}  ${tag}  ${entry.note}`
      );
    }
  }

  // Files
  console.log();
  const fileCount = item.files.length;
  console.log(`  ${pc.bold(`Files:`)} ${pc.dim(`(${fileCount})`)}`);
  const maxShown = 10;
  for (const file of item.files.slice(0, maxShown)) {
    console.log(`    ${pc.dim(file.path)}`);
  }
  if (fileCount > maxShown) {
    console.log(`    ${pc.dim(`... and ${fileCount - maxShown} more`)}`);
  }

  // Installed status
  if (installed) {
    console.log();
    console.log(
      `  ${pc.green("Installed")} ${pc.dim(`v${installedVersion}`)}`
    );
    if (updateAvailable) {
      console.log(
        `  ${pc.yellow("Update available:")} ${pc.dim(`v${installedVersion}`)} \u2192 ${pc.cyan(`v${version}`)}`
      );
    }
  }

  console.log();
}
