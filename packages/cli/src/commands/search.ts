import * as p from "@clack/prompts";
import pc from "picocolors";
import { searchRegistry } from "@kitnai/cli-core";

interface SearchOptions {
  type?: string;
}

export async function searchCommand(query: string, opts: SearchOptions) {
  const cwd = process.cwd();

  const s = p.spinner();
  s.start("Searching registry...");

  let result;
  try {
    result = await searchRegistry({ query, cwd, type: opts.type });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Found ${result.total} result(s) for "${query}"`);

  if (result.items.length === 0) {
    p.log.info(`No components matching "${query}".`);
    return;
  }

  for (const item of result.items) {
    const icon = item.installed ? pc.green("\u2713") : pc.dim("\u25CB");
    const name = item.installed ? pc.bold(item.name) : item.name;
    const type = pc.dim(`(${item.type})`);
    const ns = item.namespace !== "@kitn" ? pc.dim(` [${item.namespace}]`) : "";
    const desc = item.description ? pc.dim(` \u2014 ${item.description}`) : "";

    console.log(`  ${icon} ${name} ${type}${ns}${desc}`);
  }

  console.log();
}
