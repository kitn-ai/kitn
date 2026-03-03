import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { resolveTypeAlias } from "../utils/type-aliases.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { RegistryIndex } from "../types/registry.js";

export type IndexItemWithNamespace = RegistryIndex["items"][number] & { namespace: string };

export interface ListComponentsOpts {
  cwd: string;
  type?: string;
  registry?: string;
  installed?: boolean;
}

export interface ListComponentItem {
  name: string;
  displayName: string;
  type: string;
  description: string;
  namespace: string;
  version?: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
}

export interface ListComponentsResult {
  items: ListComponentItem[];
  groups: Map<string, ListComponentItem[]>;
  stats: {
    total: number;
    installed: number;
    updatesAvailable: number;
  };
  errors: string[];
}

export async function listComponents(opts: ListComponentsOpts): Promise<ListComponentsResult> {
  const { cwd, type, registry, installed: showInstalledOnly } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const rawType = type;
  const resolvedType = rawType ? resolveTypeAlias(rawType) : undefined;
  if (rawType && !resolvedType) {
    throw new Error(`Unknown type "${rawType}". Valid types: agent, tool, skill, storage, package`);
  }

  const fetcher = new RegistryFetcher(config.registries);
  const namespacesToFetch = registry ? [registry] : Object.keys(config.registries);

  if (registry && !config.registries[registry]) {
    throw new Error(`Registry "${registry}" is not configured.`);
  }

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
    throw new Error(`Failed to fetch registries: ${errors.join("; ")}`);
  }

  const lock = await readLock(cwd);
  const groups = new Map<string, ListComponentItem[]>();
  const items: ListComponentItem[] = [];
  let installedCount = 0;
  let updateCount = 0;

  for (const item of allItems) {
    const group = item.type.replace("kitn:", "");
    if (resolvedType && group !== resolvedType) continue;
    if (!resolvedType && group === "package") continue;

    const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
    const inst = lock[item.name] ?? lock[displayName];

    if (showInstalledOnly && !inst) continue;

    const isInstalled = !!inst;
    const hasUpdate = !!(item.version && inst && inst.version !== item.version);

    if (isInstalled) installedCount++;
    if (hasUpdate) updateCount++;

    const listItem: ListComponentItem = {
      name: item.name,
      displayName,
      type: group,
      description: item.description,
      namespace: item.namespace,
      version: item.version,
      installed: isInstalled,
      installedVersion: inst?.version,
      updateAvailable: hasUpdate,
    };

    items.push(listItem);

    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(listItem);
  }

  // Sort within groups: installed first, then alphabetical
  for (const [, groupItems] of groups) {
    groupItems.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    items,
    groups,
    stats: {
      total: items.length,
      installed: installedCount,
      updatesAvailable: updateCount,
    },
    errors,
  };
}
