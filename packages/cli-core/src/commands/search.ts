import { readConfig, readLock } from "../config/io.js";
import { DEFAULT_REGISTRIES } from "../types/config.js";
import type { KitnConfig } from "../types/config.js";
import { fetchAllIndexItems } from "./add.js";
import type { IndexItem } from "./add.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchRegistryOpts {
  query: string;
  cwd: string;
  type?: string;
}

export interface SearchResultItem {
  name: string;
  type: string;
  namespace: string;
  description: string;
  score: number;
  installed: boolean;
}

export interface SearchResult {
  query: string;
  items: SearchResultItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Main: searchRegistry
// ---------------------------------------------------------------------------

/**
 * Search the registry for components matching a query.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Works even without kitn.json (uses DEFAULT_REGISTRIES).
 * Scores results: exact name = 100, starts with = 80, contains = 60, desc contains = 40.
 */
export async function searchRegistry(opts: SearchRegistryOpts): Promise<SearchResult> {
  const { query, cwd, type } = opts;
  const lowerQuery = query.toLowerCase();

  // Try reading config, fall back to default registries
  const config = await readConfig(cwd);
  const registries: KitnConfig["registries"] = config?.registries ?? DEFAULT_REGISTRIES;

  const allItems = await fetchAllIndexItems(registries);

  // Get lock for installed status
  const lock = config ? await readLock(cwd) : {};

  // Score and filter items
  const scored: SearchResultItem[] = [];

  for (const item of allItems) {
    const typeName = item.type.replace("kitn:", "");

    // Apply type filter if specified
    if (type && typeName !== type) continue;

    const lowerName = item.name.toLowerCase();
    const lowerDesc = item.description.toLowerCase();

    let score = 0;

    if (lowerName === lowerQuery) {
      score = 100;
    } else if (lowerName.startsWith(lowerQuery)) {
      score = 80;
    } else if (lowerName.includes(lowerQuery)) {
      score = 60;
    } else if (lowerDesc.includes(lowerQuery)) {
      score = 40;
    }

    if (score === 0) continue;

    const displayName = item.namespace === "@kitn" ? item.name : `${item.namespace}/${item.name}`;
    const installed = !!(lock[item.name] ?? lock[displayName]);

    scored.push({
      name: item.name,
      type: typeName,
      namespace: item.namespace,
      description: item.description,
      score,
      installed,
    });
  }

  // Sort by score descending, then by name
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  return {
    query,
    items: scored,
    total: scored.length,
  };
}
