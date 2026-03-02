import { join } from "path";
import { readFile } from "fs/promises";
import { readConfig, readLock } from "../config/io.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import { resolveRoutesAlias } from "../types/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { typeToDir } from "../types/registry.js";
import { generateDiff } from "../installers/diff.js";

export interface DiffComponentOpts {
  component: string;
  cwd: string;
}

export interface FileDiff {
  path: string;
  status: "changed" | "identical" | "missing";
  diff?: string;
}

export interface DiffComponentResult {
  component: string;
  files: FileDiff[];
  hasDifferences: boolean;
}

async function readExistingFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function diffComponent(opts: DiffComponentOpts): Promise<DiffComponentResult> {
  const { component, cwd } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new Error(`No kitn.json found in ${cwd}. Run "kitn init" first.`);
  }

  const input = component === "routes" ? resolveRoutesAlias(config) : component;
  const ref = parseComponentRef(input);

  const lock = await readLock(cwd);
  const installedKey = ref.namespace === "@kitn" ? ref.name : `${ref.namespace}/${ref.name}`;
  const installed = lock[installedKey];
  if (!installed) {
    throw new Error(`Component "${ref.name}" is not installed.`);
  }

  const namespace = installed.registry ?? ref.namespace;
  const fetcher = new RegistryFetcher(config.registries);
  const index = await fetcher.fetchIndex(namespace);
  const indexItem = index.items.find((i) => i.name === ref.name);
  if (!indexItem) {
    throw new Error(`Component "${ref.name}" not found in ${namespace} registry.`);
  }

  const dir = typeToDir[indexItem.type] as any;
  const registryItem = await fetcher.fetchItem(ref.name, dir, namespace, ref.version);

  const files: FileDiff[] = [];
  let hasDifferences = false;

  for (const file of registryItem.files) {
    let localPath: string;
    let relativePath: string;

    if (indexItem.type === "kitn:package") {
      const baseDir = config.aliases.base ?? "src/ai";
      localPath = join(cwd, baseDir, file.path);
      relativePath = join(baseDir, file.path);
    } else {
      const fileName = file.path.split("/").pop()!;
      const aliasKey = (() => {
        switch (indexItem.type) {
          case "kitn:agent": return "agents";
          case "kitn:tool": return "tools";
          case "kitn:skill": return "skills";
          case "kitn:storage": return "storage";
          default: return "agents";
        }
      })() as "agents" | "tools" | "skills" | "storage";
      localPath = join(cwd, config.aliases[aliasKey], fileName);
      relativePath = fileName;
    }

    const localContent = await readExistingFile(localPath);

    if (localContent === null) {
      files.push({ path: relativePath, status: "missing" });
      hasDifferences = true;
    } else if (localContent !== file.content) {
      const diff = generateDiff(relativePath, localContent, file.content);
      files.push({ path: relativePath, status: "changed", diff });
      hasDifferences = true;
    } else {
      files.push({ path: relativePath, status: "identical" });
    }
  }

  return { component: ref.name, files, hasDifferences };
}
