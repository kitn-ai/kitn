import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";

interface ListOptions {
  installed?: boolean;
  type?: string;
}

export async function listCommand(opts: ListOptions) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const fetcher = new RegistryFetcher(config.registries);

  const s = p.spinner();
  s.start("Fetching registry index...");

  let index;
  try {
    index = await fetcher.fetchIndex();
  } catch (err: any) {
    s.stop(pc.red("Failed to fetch registry"));
    p.log.error(err.message);
    process.exit(1);
  }
  s.stop(`Found ${index.items.length} components`);

  const installed = config.installed ?? {};
  const typeGroups = new Map<string, typeof index.items>();

  for (const item of index.items) {
    if (opts.type && !item.type.endsWith(opts.type)) continue;

    const group = item.type.replace("kitn:", "");
    if (!typeGroups.has(group)) typeGroups.set(group, []);
    typeGroups.get(group)!.push(item);
  }

  let installedCount = 0;
  let updateCount = 0;

  for (const [group, items] of typeGroups) {
    p.log.message(pc.bold(`\n${group.charAt(0).toUpperCase() + group.slice(1)}s:`));

    for (const item of items) {
      const inst = installed[item.name];
      if (opts.installed && !inst) continue;

      const version = pc.dim(`v${item.version ?? "1.0.0"}`);

      if (inst) {
        installedCount++;
        const status = pc.green("✓");
        const hasUpdate = item.version && inst.version !== item.version;
        const updateTag = hasUpdate ? pc.yellow(` ⬆ v${item.version} available`) : "";
        if (hasUpdate) updateCount++;
        p.log.message(`  ${status} ${item.name.padEnd(20)} ${version}  ${pc.dim(item.description)}${updateTag}`);
      } else {
        const status = pc.dim("○");
        p.log.message(`  ${status} ${item.name.padEnd(20)} ${version}  ${pc.dim(item.description)}`);
      }
    }
  }

  const availableCount = index.items.length - installedCount;
  const parts = [`${installedCount} installed`, `${availableCount} available`];
  if (updateCount > 0) parts.push(`${updateCount} update${updateCount === 1 ? "" : "s"} available`);
  p.log.message("");
  p.log.message(pc.dim(`  ${parts.join(", ")}`));
}
