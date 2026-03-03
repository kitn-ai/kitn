import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import type { RegistryIndex } from "../types/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutdatedComponentsOpts {
  cwd: string;
}

export interface OutdatedItem {
  name: string;
  registry: string;
  type: string;
  installedVersion: string;
  latestVersion: string;
  isOutdated: boolean;
}

export interface OutdatedResult {
  items: OutdatedItem[];
  stats: {
    total: number;
    outdated: number;
    upToDate: number;
    unknown: number;
  };
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main: outdatedComponents
// ---------------------------------------------------------------------------

/**
 * Compare installed component versions against the latest in the registry.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 */
export async function outdatedComponents(opts: OutdatedComponentsOpts): Promise<OutdatedResult> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return {
      items: [],
      stats: { total: 0, outdated: 0, upToDate: 0, unknown: 0 },
      errors: [],
    };
  }

  const fetcher = new RegistryFetcher(config.registries);
  const errors: string[] = [];

  // Fetch all registry indices to get latest versions
  const indexCache = new Map<string, RegistryIndex>();
  for (const namespace of Object.keys(config.registries)) {
    try {
      const index = await fetcher.fetchIndex(namespace);
      indexCache.set(namespace, index);
    } catch (err: any) {
      errors.push(`${namespace}: ${err.message}`);
    }
  }

  const items: OutdatedItem[] = [];
  let outdated = 0;
  let upToDate = 0;
  let unknown = 0;

  for (const [name, entry] of entries) {
    const registry = entry.registry ?? "@kitn";
    const type = entry.type?.replace("kitn:", "") ?? "unknown";
    const installedVersion = entry.version;

    const index = indexCache.get(registry);
    if (!index) {
      items.push({
        name,
        registry,
        type,
        installedVersion,
        latestVersion: "?",
        isOutdated: false,
      });
      unknown++;
      continue;
    }

    // Find component in index — strip namespace prefix for matching
    const baseName = name.includes("/") ? name.split("/").pop()! : name;
    const indexItem = index.items.find((i) => i.name === baseName);

    if (!indexItem || !indexItem.version) {
      items.push({
        name,
        registry,
        type,
        installedVersion,
        latestVersion: "?",
        isOutdated: false,
      });
      unknown++;
      continue;
    }

    const isComponentOutdated = indexItem.version !== installedVersion;

    items.push({
      name,
      registry,
      type,
      installedVersion,
      latestVersion: indexItem.version,
      isOutdated: isComponentOutdated,
    });

    if (isComponentOutdated) {
      outdated++;
    } else {
      upToDate++;
    }
  }

  return {
    items,
    stats: {
      total: items.length,
      outdated,
      upToDate,
      unknown,
    },
    errors,
  };
}
