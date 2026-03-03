import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import type { LockFile } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentTreeOpts {
  cwd: string;
}

export interface TreeNode {
  name: string;
  type: string;
  version: string;
  children: TreeNode[];
  deduped: boolean;
}

export interface ComponentTreeResult {
  roots: TreeNode[];
  totalComponents: number;
  totalDependencies: number;
}

// ---------------------------------------------------------------------------
// Main: componentTree
// ---------------------------------------------------------------------------

/**
 * Build a dependency tree from the lock file.
 *
 * Pure lock-file operation -- NO network requests.
 *
 * Root nodes are components not in any other component's registryDependencies.
 * Duplicate subtrees are marked as `deduped: true` to avoid infinite recursion.
 */
export async function componentTree(opts: ComponentTreeOpts): Promise<ComponentTreeResult> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return { roots: [], totalComponents: 0, totalDependencies: 0 };
  }

  // Build adjacency: name -> deps that are also in the lock
  const adjacency = new Map<string, string[]>();
  const allDependedOn = new Set<string>();

  for (const [name, entry] of entries) {
    const deps = (entry.registryDependencies ?? []).filter((d) => lock[d]);
    adjacency.set(name, deps);
    for (const dep of deps) {
      allDependedOn.add(dep);
    }
  }

  // Root nodes: components not depended on by anything
  const rootNames = entries
    .map(([name]) => name)
    .filter((name) => !allDependedOn.has(name));

  // Build tree recursively, tracking seen nodes for dedup
  const seen = new Set<string>();
  let totalDeps = 0;

  function buildNode(name: string): TreeNode {
    const entry = lock[name];
    const type = entry?.type?.replace("kitn:", "") ?? "unknown";
    const version = entry?.version ?? "?";
    const deps = adjacency.get(name) ?? [];

    if (seen.has(name)) {
      return { name, type, version, children: [], deduped: true };
    }

    seen.add(name);
    const children = deps.map((dep) => {
      totalDeps++;
      return buildNode(dep);
    });

    return { name, type, version, children, deduped: false };
  }

  const roots = rootNames.map(buildNode);

  return {
    roots,
    totalComponents: entries.length,
    totalDependencies: totalDeps,
  };
}

// ---------------------------------------------------------------------------
// renderTree — plain text with box-drawing characters
// ---------------------------------------------------------------------------

/**
 * Render a dependency tree as plain text with box-drawing characters.
 * Suitable for console output (no ANSI colors — the CLI wrapper adds those).
 */
export function renderTree(roots: TreeNode[]): string {
  const lines: string[] = [];

  function renderNode(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const deduped = node.deduped ? " [deduped]" : "";
    const type = `(${node.type})`;
    lines.push(`${prefix}${connector}${node.name} ${type}${deduped}`);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < node.children.length; i++) {
      renderNode(node.children[i], childPrefix, i === node.children.length - 1, false);
    }
  }

  for (const root of roots) {
    renderNode(root, "", true, true);
  }

  return lines.join("\n");
}
