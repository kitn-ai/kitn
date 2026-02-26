import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { RegistryIndex } from "../registry/schema.js";

interface ListOptions {
  installed?: boolean;
  type?: string;
  registry?: string;
  verbose?: boolean;
}

type IndexItemWithNamespace = RegistryIndex["items"][number] & { namespace: string };

const TYPE_ALIASES: Record<string, string> = {
  agent: "agent",
  agents: "agent",
  tool: "tool",
  tools: "tool",
  skill: "skill",
  skills: "skill",
  storage: "storage",
  storages: "storage",
  package: "package",
  packages: "package",
};

export async function listCommand(typeFilter: string | undefined, opts: ListOptions) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // Resolve type filter from positional arg or --type flag
  const rawType = typeFilter ?? opts.type;
  const resolvedType = rawType ? TYPE_ALIASES[rawType.toLowerCase()] : undefined;
  if (rawType && !resolvedType) {
    p.log.error(`Unknown type ${pc.bold(rawType)}. Valid types: agent, tool, skill, storage, package`);
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
  s.start("Fetching registry...");

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

  s.stop(`Found ${allItems.length} components`);

  for (const e of errors) {
    p.log.warn(`${pc.yellow("⚠")} Failed to fetch ${e}`);
  }

  const installed = config.installed ?? {};
  const typeGroups = new Map<string, IndexItemWithNamespace[]>();

  for (const item of allItems) {
    const group = item.type.replace("kitn:", "");
    if (resolvedType && group !== resolvedType) continue;
    if (!typeGroups.has(group)) typeGroups.set(group, []);
    typeGroups.get(group)!.push(item);
  }

  // Calculate max name width for alignment
  let maxName = 0;
  for (const items of typeGroups.values()) {
    for (const item of items) {
      const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
      if (displayName.length > maxName) maxName = displayName.length;
    }
  }

  const cols = process.stdout.columns ?? 80;
  // Layout: "  ✓ name__  [vX.X.X  ]description"
  const versionLen = opts.verbose ? 10 : 0;
  const prefixLen = 4 + maxName + 2 + versionLen;

  let installedCount = 0;
  let updateCount = 0;
  let shownCount = 0;

  for (const [group, items] of typeGroups) {
    // Sort: installed first, then alphabetical
    items.sort((a, b) => {
      const aInst = !!(installed[a.name] ?? installed[`${a.namespace}/${a.name}`]);
      const bInst = !!(installed[b.name] ?? installed[`${b.namespace}/${b.name}`]);
      if (aInst !== bInst) return aInst ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const label = group.charAt(0).toUpperCase() + group.slice(1) + "s";
    console.log(`\n  ${pc.bold(label)} ${pc.dim(`(${items.length})`)}`);

    for (const item of items) {
      const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
      const inst = installed[item.name] ?? installed[displayName];
      if (opts.installed && !inst) continue;

      const maxDescLen = Math.max(20, cols - prefixLen);

      let desc = item.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 1) + "…";
      }

      let line: string;
      const nameCol = displayName.padEnd(maxName + 2);
      const version = opts.verbose ? `${pc.dim(`v${item.version ?? "1.0.0"}`)}  ` : "";

      if (inst) {
        installedCount++;
        const hasUpdate = item.version && inst.version !== item.version;
        if (hasUpdate) updateCount++;
        const updateTag = hasUpdate ? pc.yellow(` ↑${item.version}`) : "";
        line = `  ${pc.green("✓")} ${nameCol}${version}${pc.dim(desc)}${updateTag}`;
      } else {
        line = `  ${pc.dim("○")} ${nameCol}${version}${pc.dim(desc)}`;
      }

      console.log(line);
      shownCount++;
    }
  }

  if (shownCount === 0 && resolvedType) {
    console.log(pc.dim(`\n  No ${resolvedType} components found.`));
  }

  const parts = [`${installedCount} installed`, `${allItems.length - installedCount} available`];
  if (updateCount > 0) parts.push(pc.yellow(`${updateCount} update${updateCount === 1 ? "" : "s"}`));
  console.log(`\n  ${pc.dim(parts.join("  ·  "))}\n`);
}
