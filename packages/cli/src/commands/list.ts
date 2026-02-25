import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { RegistryIndex } from "../registry/schema.js";

interface ListOptions {
  installed?: boolean;
  type?: string;
  registry?: string;
}

type IndexItemWithNamespace = RegistryIndex["items"][number] & { namespace: string };

export async function listCommand(opts: ListOptions) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const fetcher = new RegistryFetcher(config.registries);

  const namespacesToFetch = opts.registry
    ? [opts.registry]
    : Object.keys(config.registries);

  if (opts.registry && !config.registries[opts.registry]) {
    p.log.error(`Registry ${pc.bold(opts.registry)} is not configured. Run ${pc.bold("kitn registry list")} to see configured registries.`);
    process.exit(1);
  }

  const s = p.spinner();
  s.start("Fetching registry index...");

  const allItems: IndexItemWithNamespace[] = [];
  const errors: string[] = [];

  for (const namespace of namespacesToFetch) {
    try {
      const index = await fetcher.fetchIndex(namespace);
      for (const item of index.items) {
        allItems.push({ ...item, namespace });
      }
    } catch (err: any) {
      errors.push(`${namespace}: ${err.message}`);
    }
  }

  if (allItems.length === 0 && errors.length > 0) {
    s.stop(pc.red("Failed to fetch registries"));
    for (const e of errors) p.log.error(e);
    process.exit(1);
  }

  s.stop(`Found ${allItems.length} components across ${namespacesToFetch.length - errors.length} ${namespacesToFetch.length - errors.length === 1 ? "registry" : "registries"}`);

  for (const e of errors) {
    p.log.warn(`${pc.yellow("⚠")} Failed to fetch ${e}`);
  }

  const installed = config.installed ?? {};
  const typeGroups = new Map<string, IndexItemWithNamespace[]>();

  for (const item of allItems) {
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
      const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
      const inst = installed[item.name] ?? installed[displayName];
      if (opts.installed && !inst) continue;

      const version = pc.dim(`v${item.version ?? "1.0.0"}`);

      if (inst) {
        installedCount++;
        const status = pc.green("✓");
        const hasUpdate = item.version && inst.version !== item.version;
        const updateTag = hasUpdate ? pc.yellow(` ⬆ v${item.version} available`) : "";
        if (hasUpdate) updateCount++;
        p.log.message(`  ${status} ${displayName.padEnd(20)} ${version}  ${pc.dim(item.description)}${updateTag}`);
      } else {
        const status = pc.dim("○");
        p.log.message(`  ${status} ${displayName.padEnd(20)} ${version}  ${pc.dim(item.description)}`);
      }
    }
  }

  const availableCount = allItems.length - installedCount;
  const parts = [`${installedCount} installed`, `${availableCount} available`];
  if (updateCount > 0) parts.push(`${updateCount} update${updateCount === 1 ? "" : "s"} available`);
  p.log.message("");
  p.log.message(pc.dim(`  ${parts.join(", ")}`));
}
