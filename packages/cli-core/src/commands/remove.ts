import { join, relative, dirname } from "path";
import { unlink, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { readConfig, readLock, writeLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { resolveRoutesAlias } from "../types/config.js";
import type { KitnConfig, LockFile } from "../types/config.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { removeImportFromBarrel } from "../installers/barrel-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemoveComponentOpts {
  component: string;
  cwd: string;
}

export interface RemoveResult {
  removed: { name: string; files: string[] };
  /** Dependencies that are no longer needed by any other installed component */
  orphans: string[];
  /** Files that could not be deleted (e.g. moved or renamed by user) */
  failedDeletes: string[];
  /** Whether the barrel file was updated */
  barrelUpdated: boolean;
}

export interface RemoveMultipleOpts {
  components: string[];
  cwd: string;
}

export interface RemoveMultipleResult {
  removed: Array<{ name: string; files: string[] }>;
  orphans: string[];
  failedDeletes: string[];
  barrelUpdated: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove a single component's files from disk, barrel imports, and lock entry.
 * Mutates the `lock` object directly.
 */
async function removeSingleComponentFiles(
  installedKey: string,
  lock: LockFile,
  config: KitnConfig,
  cwd: string,
): Promise<{ deleted: string[]; failedDeletes: string[]; barrelUpdated: boolean }> {
  const entry = lock[installedKey];
  if (!entry) return { deleted: [], failedDeletes: [], barrelUpdated: false };

  const deleted: string[] = [];
  const failedDeletes: string[] = [];

  for (const filePath of entry.files) {
    try {
      await unlink(join(cwd, filePath));
      deleted.push(filePath);
    } catch {
      failedDeletes.push(filePath);
    }
  }

  // Remove barrel imports for deleted files
  const baseDir = config.aliases.base ?? "src/ai";
  const barrelPath = join(cwd, baseDir, "index.ts");
  const barrelDir = join(cwd, baseDir);
  const barrelEligibleDirs = new Set([
    config.aliases.agents,
    config.aliases.tools,
    config.aliases.skills,
  ]);

  let barrelUpdated = false;

  if (existsSync(barrelPath) && deleted.length > 0) {
    let barrelContent = await readFile(barrelPath, "utf-8");
    let barrelChanged = false;

    for (const filePath of deleted) {
      const fileDir = dirname(filePath);
      if (!barrelEligibleDirs.has(fileDir)) continue;

      const importPath = "./" + relative(barrelDir, join(cwd, filePath)).replace(/\\/g, "/");
      const updated = removeImportFromBarrel(barrelContent, importPath);
      if (updated !== barrelContent) {
        barrelContent = updated;
        barrelChanged = true;
      }
    }

    if (barrelChanged) {
      await writeFile(barrelPath, barrelContent);
      barrelUpdated = true;
    }
  }

  delete lock[installedKey];

  return { deleted, failedDeletes, barrelUpdated };
}

/**
 * Calculate orphaned dependencies: deps that were used by removed components
 * but are not needed by any remaining installed component.
 */
export function findOrphans(removedDeps: Set<string>, lock: LockFile): string[] {
  const neededDeps = new Set<string>();
  for (const [, entry] of Object.entries(lock)) {
    if (entry.registryDependencies) {
      for (const dep of entry.registryDependencies) {
        neededDeps.add(dep);
      }
    }
  }

  // Never offer to remove "core"
  return [...removedDeps].filter(
    (dep) => dep !== "core" && !neededDeps.has(dep) && lock[dep],
  );
}

// ---------------------------------------------------------------------------
// Main: removeComponent
// ---------------------------------------------------------------------------

/**
 * Remove a single component from a kitn project.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * The caller is responsible for:
 * - Confirmation prompts
 * - Orphan removal prompts (orphans are returned, not auto-removed)
 * - Output formatting
 */
export async function removeComponent(opts: RemoveComponentOpts): Promise<RemoveResult> {
  const { component, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);

  // Resolve "routes" alias
  const input = component === "routes" ? resolveRoutesAlias(config) : component;
  const ref = parseComponentRef(input);

  // Look up in lock
  const installedKey = ref.namespace === "@kitn" ? ref.name : `${ref.namespace}/${ref.name}`;
  const entry = lock[installedKey];
  if (!entry) {
    throw new Error(`Component '${ref.name}' is not installed.`);
  }

  // Snapshot deps before removal
  const removedDeps = new Set(entry.registryDependencies ?? []);

  const { deleted, failedDeletes, barrelUpdated } = await removeSingleComponentFiles(
    installedKey,
    lock,
    config,
    cwd,
  );

  // Calculate orphans
  const orphans = findOrphans(removedDeps, lock);

  // Write updated lock
  await writeLock(cwd, lock);

  return {
    removed: { name: installedKey, files: deleted },
    orphans,
    failedDeletes,
    barrelUpdated,
  };
}

/**
 * Remove multiple components from a kitn project.
 *
 * Pure logic -- no interactive prompts.
 */
export async function removeMultipleComponents(opts: RemoveMultipleOpts): Promise<RemoveMultipleResult> {
  const { components, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);

  // Snapshot all deps before removal
  const allRemovedDeps = new Set<string>();
  for (const key of components) {
    const entry = lock[key];
    if (entry?.registryDependencies) {
      for (const dep of entry.registryDependencies) {
        allRemovedDeps.add(dep);
      }
    }
  }

  const removed: Array<{ name: string; files: string[] }> = [];
  const allFailedDeletes: string[] = [];
  let anyBarrelUpdated = false;

  for (const key of components) {
    const { deleted, failedDeletes, barrelUpdated } = await removeSingleComponentFiles(
      key,
      lock,
      config,
      cwd,
    );
    removed.push({ name: key, files: deleted });
    allFailedDeletes.push(...failedDeletes);
    if (barrelUpdated) anyBarrelUpdated = true;
  }

  // Calculate orphans
  const orphans = findOrphans(allRemovedDeps, lock);

  // Write updated lock
  await writeLock(cwd, lock);

  return {
    removed,
    orphans,
    failedDeletes: allFailedDeletes,
    barrelUpdated: anyBarrelUpdated,
  };
}

/**
 * Remove orphaned dependencies.
 * Call after removeComponent/removeMultipleComponents with the orphan keys the user confirmed.
 */
export async function removeOrphans(
  orphanKeys: string[],
  cwd: string,
): Promise<Array<{ name: string; files: string[] }>> {
  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const removed: Array<{ name: string; files: string[] }> = [];

  for (const key of orphanKeys) {
    const { deleted } = await removeSingleComponentFiles(key, lock, config, cwd);
    removed.push({ name: key, files: deleted });
  }

  await writeLock(cwd, lock);
  return removed;
}
