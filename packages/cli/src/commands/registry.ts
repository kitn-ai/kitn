import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig, getRegistryUrl, readLock } from "../utils/config.js";
import type { RegistryEntry } from "../utils/config.js";

interface RegistryAddOptions {
  cwd?: string;
  overwrite?: boolean;
  homepage?: string;
  description?: string;
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

  // Store as rich entry if homepage or description provided, otherwise plain URL
  if (opts.homepage || opts.description) {
    const entry: RegistryEntry = { url };
    if (opts.homepage) entry.homepage = opts.homepage;
    if (opts.description) entry.description = opts.description;
    config.registries[namespace] = entry;
  } else {
    config.registries[namespace] = url;
  }
  await writeConfig(cwd, config);

  p.log.success(`Added registry ${pc.bold(namespace)}`);
  p.log.message(pc.dim(`  ${url}`));
  if (opts.homepage) p.log.message(pc.dim(`  Homepage: ${opts.homepage}`));
  if (opts.description) p.log.message(pc.dim(`  ${opts.description}`));
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

  const lock = await readLock(cwd);
  const affectedComponents: string[] = [];
  for (const [name, entry] of Object.entries(lock)) {
    if (entry.registry === namespace) {
      affectedComponents.push(name);
    }
  }

  delete config.registries[namespace];
  await writeConfig(cwd, config);

  p.log.success(`Removed registry ${pc.bold(namespace)}`);
  if (affectedComponents.length > 0) {
    p.log.warn(`${affectedComponents.length} installed component(s) referenced this registry:\n` + affectedComponents.map((name) => `  ${pc.yellow("!")} ${name}`).join("\n"));
  }

  return { affectedComponents };
}

export async function registryListCommand(
  opts: RegistryListOptions = {},
): Promise<Array<{ namespace: string; url: string; homepage?: string; description?: string }>> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) throw new Error("No kitn.json found. Run `kitn init` first.");

  const entries = Object.entries(config.registries).map(([namespace, value]) => {
    const url = getRegistryUrl(value);
    const homepage = typeof value === "object" ? value.homepage : undefined;
    const description = typeof value === "object" ? value.description : undefined;
    return { namespace, url, homepage, description };
  });

  if (entries.length === 0) {
    p.log.message(pc.dim("  No registries configured."));
  } else {
    const lines: string[] = [];
    for (const { namespace, url, homepage, description } of entries) {
      lines.push(`  ${pc.bold(namespace.padEnd(16))} ${pc.dim(url)}`);
      if (description) lines.push(`  ${" ".repeat(16)} ${description}`);
      if (homepage) lines.push(`  ${" ".repeat(16)} ${pc.dim(homepage)}`);
    }
    p.log.message(lines.join("\n"));
  }

  return entries;
}
