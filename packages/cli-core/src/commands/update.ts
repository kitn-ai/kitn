import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { addComponents } from "./add.js";
import type { AddResult } from "./add.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateComponentsOpts {
  /** Specific components to update. If empty/undefined, updates all installed components. */
  components?: string[];
  cwd: string;
}

// ---------------------------------------------------------------------------
// Main: updateComponents
// ---------------------------------------------------------------------------

/**
 * Update installed components by re-installing from the registry with overwrite.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * If no components are specified, reads the lock file and updates all installed components.
 * Delegates to `addComponents` with `overwrite: true`.
 */
export async function updateComponents(opts: UpdateComponentsOpts): Promise<AddResult> {
  const { cwd } = opts;
  let components = opts.components ?? [];

  if (components.length === 0) {
    const config = await readConfig(cwd);
    if (!config) {
      throw new NotInitializedError(cwd);
    }

    const lock = await readLock(cwd);
    const keys = Object.keys(lock);
    if (keys.length === 0) {
      throw new Error("No installed components to update.");
    }

    components = keys;
  }

  return addComponents({
    components,
    cwd,
    overwrite: true,
  });
}
