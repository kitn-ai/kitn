import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { typeToDir } from "../registry/schema.js";

export async function infoCommand(component: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const ref = parseComponentRef(component);
  const fetcher = new RegistryFetcher(config.registries);

  const s = p.spinner();
  s.start("Fetching component info...");

  // Fetch registry index to find the component and get available versions
  let index;
  try {
    index = await fetcher.fetchIndex(ref.namespace);
  } catch (err: any) {
    s.stop(pc.red("Failed to fetch registry"));
    p.log.error(err.message);
    process.exit(1);
  }

  const indexItem = index.items.find((i) => i.name === ref.name);
  if (!indexItem) {
    s.stop(pc.red("Component not found"));
    p.log.error(`Component '${ref.name}' not found in registry.`);
    process.exit(1);
  }

  // Fetch the full component JSON (specific version or latest)
  const dir = typeToDir[indexItem.type] as any;
  let item;
  try {
    item = await fetcher.fetchItem(ref.name, dir, ref.namespace, ref.version);
  } catch (err: any) {
    s.stop(pc.red("Failed to fetch component"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop("Component found");

  // Display formatted output
  const version = item.version ?? indexItem.version ?? "unknown";
  const typeName = indexItem.type.replace("kitn:", "");

  // Header: name, version, namespace
  console.log();
  console.log(
    `  ${pc.bold(item.name)} ${pc.cyan(`v${version}`)}${" ".repeat(Math.max(1, 40 - item.name.length - version.length - 2))}${pc.dim(ref.namespace)}`
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
  const installed = config.installed?.[item.name];
  if (installed) {
    console.log();
    console.log(
      `  ${pc.green("Installed")} ${pc.dim(`v${installed.version}`)}`
    );
    if (version !== installed.version) {
      console.log(
        `  ${pc.yellow("Update available:")} ${pc.dim(`v${installed.version}`)} → ${pc.cyan(`v${version}`)}`
      );
    }
  }

  console.log();
}
