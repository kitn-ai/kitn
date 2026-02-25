import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";

interface RegistryAddOptions {
  cwd?: string;
  overwrite?: boolean;
}

interface RegistryRemoveOptions {
  cwd?: string;
  force?: boolean;
}

interface RegistryListOptions {
  cwd?: string;
}

export async function registryAddCommand(
  namespace: string,
  url: string,
  opts: RegistryAddOptions = {},
) {
  const cwd = opts.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) throw new Error("No kitn.json found. Run `kitn init` first.");

  if (!namespace.startsWith("@")) {
    throw new Error("Namespace must start with @ (e.g. @myteam)");
  }
  if (!url.includes("{type}")) {
    throw new Error("URL template must include {type} placeholder");
  }
  if (!url.includes("{name}")) {
    throw new Error("URL template must include {name} placeholder");
  }
  if (config.registries[namespace] && !opts.overwrite) {
    throw new Error(`Registry '${namespace}' is already configured. Use --overwrite to replace.`);
  }

  config.registries[namespace] = url;
  await writeConfig(cwd, config);

  p.log.success(`Added registry ${pc.bold(namespace)}`);
  p.log.message(pc.dim(`  ${url}`));
}

export async function registryRemoveCommand(
  namespace: string,
  opts: RegistryRemoveOptions = {},
): Promise<{ affectedComponents: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) throw new Error("No kitn.json found. Run `kitn init` first.");

  if (!config.registries[namespace]) {
    throw new Error(`Registry '${namespace}' is not configured.`);
  }
  if (namespace === "@kitn" && !opts.force) {
    throw new Error("Cannot remove the default @kitn registry. Use --force to override.");
  }

  const affectedComponents: string[] = [];
  if (config.installed) {
    for (const [name, entry] of Object.entries(config.installed)) {
      if (entry.registry === namespace) {
        affectedComponents.push(name);
      }
    }
  }

  delete config.registries[namespace];
  await writeConfig(cwd, config);

  p.log.success(`Removed registry ${pc.bold(namespace)}`);
  if (affectedComponents.length > 0) {
    p.log.warn(`${affectedComponents.length} installed component(s) referenced this registry:`);
    for (const name of affectedComponents) {
      p.log.message(`  ${pc.yellow("!")} ${name}`);
    }
  }

  return { affectedComponents };
}

export async function registryListCommand(
  opts: RegistryListOptions = {},
): Promise<Array<{ namespace: string; url: string }>> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) throw new Error("No kitn.json found. Run `kitn init` first.");

  const entries = Object.entries(config.registries).map(([namespace, url]) => ({ namespace, url }));

  if (entries.length === 0) {
    p.log.message(pc.dim("  No registries configured."));
  } else {
    for (const { namespace, url } of entries) {
      p.log.message(`  ${pc.bold(namespace.padEnd(16))} ${pc.dim(url)}`);
    }
  }

  return entries;
}
