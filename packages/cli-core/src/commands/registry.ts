import { readConfig, writeConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { getRegistryUrl } from "../types/config.js";
import type { RegistryEntry } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryInfo {
  namespace: string;
  url: string;
  homepage?: string;
  description?: string;
}

export interface AddRegistryOpts {
  namespace: string;
  url: string;
  cwd: string;
  overwrite?: boolean;
  homepage?: string;
  description?: string;
}

export interface RemoveRegistryOpts {
  namespace: string;
  cwd: string;
  force?: boolean;
}

export interface RemoveRegistryResult {
  affectedComponents: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a registry namespace and URL template.
 * Throws descriptive errors on invalid input.
 */
export function validateRegistryInput(namespace: string, url: string): void {
  if (!namespace.startsWith("@")) {
    throw new Error("Namespace must start with @ (e.g. @myteam)");
  }
  if (!url.includes("{type}")) {
    throw new Error("URL template must include {type} placeholder");
  }
  if (!url.includes("{name}")) {
    throw new Error("URL template must include {name} placeholder");
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Add a registry to the project configuration.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 */
export async function addRegistry(opts: AddRegistryOpts): Promise<void> {
  const { namespace, url, cwd, overwrite, homepage, description } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  validateRegistryInput(namespace, url);

  if (config.registries[namespace] && !overwrite) {
    throw new Error(`Registry '${namespace}' is already configured. Use --overwrite to replace.`);
  }

  // Store as rich entry if homepage or description provided, otherwise plain URL
  if (homepage || description) {
    const entry: RegistryEntry = { url };
    if (homepage) entry.homepage = homepage;
    if (description) entry.description = description;
    config.registries[namespace] = entry;
  } else {
    config.registries[namespace] = url;
  }

  await writeConfig(cwd, config);
}

/**
 * Remove a registry from the project configuration.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Returns the list of installed components that referenced this registry.
 */
export async function removeRegistry(opts: RemoveRegistryOpts): Promise<RemoveRegistryResult> {
  const { namespace, cwd, force } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  if (!config.registries[namespace]) {
    throw new Error(`Registry '${namespace}' is not configured.`);
  }

  if (namespace === "@kitn" && !force) {
    throw new Error("Cannot remove the default @kitn registry. Use --force to override.");
  }

  const lock = await readLock(cwd);
  const affectedComponents: string[] = [];
  for (const [name, entry] of Object.entries(lock)) {
    if (entry.registry === namespace) {
      affectedComponents.push(name);
    }
  }

  delete config.registries[namespace];
  await writeConfig(cwd, config);

  return { affectedComponents };
}

/**
 * List all registries in the project configuration.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 */
export async function listRegistries(opts: {
  cwd: string;
}): Promise<RegistryInfo[]> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  return Object.entries(config.registries).map(([namespace, value]) => {
    const url = getRegistryUrl(value);
    const homepage = typeof value === "object" ? value.homepage : undefined;
    const description = typeof value === "object" ? value.description : undefined;
    return { namespace, url, homepage, description };
  });
}
