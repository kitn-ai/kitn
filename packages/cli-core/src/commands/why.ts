import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import type { LockFile } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhyComponentOpts {
  component: string;
  cwd: string;
}

export interface WhyResult {
  component: string;
  /** Components that directly depend on this component. */
  dependents: string[];
  /** Whether the component is a top-level install (not a dependency of anything). */
  isTopLevel: boolean;
  /** Full dependency chains leading to this component. */
  chains: string[][];
  /** Whether the component exists in the lock file. */
  found: boolean;
}

// ---------------------------------------------------------------------------
// Main: whyComponent
// ---------------------------------------------------------------------------

/**
 * Explain why a component is installed by showing its reverse dependencies.
 *
 * Pure lock-file operation -- NO network requests.
 *
 * Builds a reverse dependency map from registryDependencies and traces
 * all paths that lead to the queried component.
 */
export async function whyComponent(opts: WhyComponentOpts): Promise<WhyResult> {
  const { component, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);

  if (!lock[component]) {
    return {
      component,
      dependents: [],
      isTopLevel: false,
      chains: [],
      found: false,
    };
  }

  // Build reverse dependency map: component -> list of components that depend on it
  const reverseDeps = buildReverseDeps(lock);

  const directDependents = reverseDeps.get(component) ?? [];
  const isTopLevel = directDependents.length === 0;

  // Build all chains leading to this component
  const chains = buildChains(component, reverseDeps);

  return {
    component,
    dependents: directDependents,
    isTopLevel,
    chains,
    found: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReverseDeps(lock: LockFile): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const [name, entry] of Object.entries(lock)) {
    const deps = entry.registryDependencies ?? [];
    for (const dep of deps) {
      if (!reverse.has(dep)) {
        reverse.set(dep, []);
      }
      reverse.get(dep)!.push(name);
    }
  }

  return reverse;
}

function buildChains(
  target: string,
  reverseDeps: Map<string, string[]>,
): string[][] {
  const chains: string[][] = [];

  function walk(current: string, path: string[]) {
    const dependents = reverseDeps.get(current) ?? [];

    if (dependents.length === 0) {
      // Reached a root — this is a complete chain
      if (path.length > 1) {
        chains.push([...path].reverse());
      }
      return;
    }

    for (const dep of dependents) {
      if (path.includes(dep)) continue; // Avoid cycles
      walk(dep, [...path, dep]);
    }
  }

  walk(target, [target]);
  return chains;
}
