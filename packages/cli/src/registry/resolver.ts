import type { RegistryItem } from "./schema.js";

type FetchItemFn = (name: string) => Promise<RegistryItem>;

export async function resolveDependencies(
  names: string[],
  fetchItem: FetchItemFn
): Promise<RegistryItem[]> {
  const visited = new Set<string>();
  const items = new Map<string, RegistryItem>();
  const edges: [string, string][] = [];

  async function resolve(name: string): Promise<void> {
    if (visited.has(name)) return;
    visited.add(name);

    const item = await fetchItem(name);
    items.set(name, item);

    const deps = item.registryDependencies ?? [];
    for (const dep of deps) {
      edges.push([dep, name]);
      await resolve(dep);
    }
  }

  for (const name of names) {
    await resolve(name);
  }

  return topologicalSort(items, edges);
}

function topologicalSort(
  items: Map<string, RegistryItem>,
  edges: [string, string][]
): RegistryItem[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const name of items.keys()) {
    inDegree.set(name, 0);
    adjacency.set(name, []);
  }

  for (const [from, to] of edges) {
    adjacency.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: RegistryItem[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(items.get(name)!);

    for (const neighbor of adjacency.get(name) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== items.size) {
    const missing = [...items.keys()].filter((n) => !sorted.some((s) => s.name === n));
    throw new Error(`Circular dependency detected involving: ${missing.join(", ")}`);
  }

  return sorted;
}
