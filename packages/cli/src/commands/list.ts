import * as p from "@clack/prompts";
import pc from "picocolors";
import { listComponents } from "@kitnai/cli-core";

interface ListOptions {
  installed?: boolean;
  type?: string;
  registry?: string;
  verbose?: boolean;
}

export async function listCommand(typeFilter: string | undefined, opts: ListOptions) {
  const cwd = process.cwd();

  // Resolve type filter from positional arg or --type flag
  const rawType = typeFilter ?? opts.type;

  const s = p.spinner();
  s.start("Fetching registry...");

  let result;
  try {
    result = await listComponents({
      cwd,
      type: rawType,
      registry: opts.registry,
      installed: opts.installed,
    });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  const totalFetched = result.items.length + (result.errors.length > 0 ? 0 : 0);
  s.stop(`Found ${result.stats.total} components`);

  for (const e of result.errors) {
    p.log.warn(`${pc.yellow("\u26A0")} Failed to fetch ${e}`);
  }

  // Calculate max name width for alignment
  let maxName = 0;
  for (const item of result.items) {
    if (item.displayName.length > maxName) maxName = item.displayName.length;
  }

  const cols = process.stdout.columns ?? 80;
  // Layout: "  \u2713 name__  [vX.X.X  ]description"
  const versionLen = opts.verbose ? 10 : 0;
  const prefixLen = 4 + maxName + 2 + versionLen;

  let shownCount = 0;

  for (const [group, items] of result.groups) {
    const label = group.charAt(0).toUpperCase() + group.slice(1) + "s";
    console.log(`\n  ${pc.bold(label)} ${pc.dim(`(${items.length})`)}`);

    for (const item of items) {
      const maxDescLen = Math.max(20, cols - prefixLen);

      let desc = item.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 1) + "\u2026";
      }

      let line: string;
      const nameCol = item.displayName.padEnd(maxName + 2);
      const version = opts.verbose ? `${pc.dim(`v${item.version ?? "1.0.0"}`)}  ` : "";

      if (item.installed) {
        const updateTag = item.updateAvailable ? pc.yellow(` \u2191${item.version}`) : "";
        line = `  ${pc.green("\u2713")} ${nameCol}${version}${pc.dim(desc)}${updateTag}`;
      } else {
        line = `  ${pc.dim("\u25CB")} ${nameCol}${version}${pc.dim(desc)}`;
      }

      console.log(line);
      shownCount++;
    }
  }

  if (shownCount === 0 && rawType) {
    console.log(pc.dim(`\n  No ${rawType} components found.`));
  }

  const parts = [`${result.stats.installed} installed`, `${result.stats.total - result.stats.installed} available`];
  if (result.stats.updatesAvailable > 0) parts.push(pc.yellow(`${result.stats.updatesAvailable} update${result.stats.updatesAvailable === 1 ? "" : "s"}`));
  console.log(`\n  ${pc.dim(parts.join("  \u00B7  "))}\n`);
}
