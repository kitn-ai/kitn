import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { typeToDir } from "../types/registry.js";
import type { RegistryItem, RegistryIndex } from "../types/registry.js";

export interface ComponentInfoOpts {
  component: string;
  cwd: string;
}

export interface ComponentInfoResult {
  item: RegistryItem;
  indexItem: RegistryIndex["items"][number];
  namespace: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
}

export async function getComponentInfo(opts: ComponentInfoOpts): Promise<ComponentInfoResult> {
  const { component, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const ref = parseComponentRef(component);
  const fetcher = new RegistryFetcher(config.registries);

  const index = await fetcher.fetchIndex(ref.namespace);
  const indexItem = index.items.find((i) => i.name === ref.name);
  if (!indexItem) {
    throw new Error(`Component "${ref.name}" not found in ${ref.namespace} registry.`);
  }

  const dir = typeToDir[indexItem.type] as any;
  const item = await fetcher.fetchItem(ref.name, dir, ref.namespace, ref.version);

  const lock = await readLock(cwd);
  const inst = lock[item.name];
  const version = item.version ?? indexItem.version ?? "unknown";

  return {
    item,
    indexItem,
    namespace: ref.namespace,
    installed: !!inst,
    installedVersion: inst?.version,
    updateAvailable: !!(inst && version !== inst.version),
  };
}
