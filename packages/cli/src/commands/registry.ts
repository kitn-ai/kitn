import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  addRegistry,
  removeRegistry,
  listRegistries,
} from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

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
  let cwd = opts.cwd ?? process.cwd();
  ({ cwd } = await requireConfig(cwd));

  try {
    await addRegistry({
      namespace,
      url,
      cwd,
      overwrite: opts.overwrite,
      homepage: opts.homepage,
      description: opts.description,
    });

    p.log.success(`Added registry ${pc.bold(namespace)}`);
    p.log.message(pc.dim(`  ${url}`));
    if (opts.homepage) p.log.message(pc.dim(`  Homepage: ${opts.homepage}`));
    if (opts.description) p.log.message(pc.dim(`  ${opts.description}`));
  } catch (err: any) {
    throw err;
  }
}

export async function registryRemoveCommand(
  namespace: string,
  opts: RegistryRemoveOptions = {},
): Promise<{ affectedComponents: string[] }> {
  let cwd = opts.cwd ?? process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const result = await removeRegistry({
    namespace,
    cwd,
    force: opts.force,
  });

  p.log.success(`Removed registry ${pc.bold(namespace)}`);
  if (result.affectedComponents.length > 0) {
    p.log.warn(
      `${result.affectedComponents.length} installed component(s) referenced this registry:\n` +
        result.affectedComponents
          .map((name) => `  ${pc.yellow("!")} ${name}`)
          .join("\n"),
    );
  }

  return result;
}

export async function registryListCommand(
  opts: RegistryListOptions = {},
): Promise<
  Array<{
    namespace: string;
    url: string;
    homepage?: string;
    description?: string;
  }>
> {
  let cwd = opts.cwd ?? process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const entries = await listRegistries({ cwd });

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
