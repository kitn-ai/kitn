import * as p from "@clack/prompts";
import pc from "picocolors";
import { resolve, relative } from "path";
import { scanForComponents, writeRegistryOutput } from "../registry/build-output.js";
import { buildComponent } from "../registry/builder.js";
import type { RegistryItem } from "../registry/schema.js";

interface BuildOptions {
  output?: string;
}

export async function buildCommand(paths: string[], opts: BuildOptions) {
  p.intro(pc.bgCyan(pc.black(" kitn build ")));

  const cwd = process.cwd();
  const outputDir = resolve(cwd, opts.output ?? "dist/r");

  const s = p.spinner();
  s.start("Scanning for components...");

  const componentDirs = await scanForComponents(cwd, paths.length > 0 ? paths : undefined);

  if (componentDirs.length === 0) {
    s.stop("No components found");
    p.log.info(
      `No directories with ${pc.bold("registry.json")} found. Run ${pc.bold("kitn create")} to scaffold a component.`
    );
    return;
  }

  s.stop(`Found ${componentDirs.length} component(s)`);
  for (const dir of componentDirs) {
    p.log.message(`  ${pc.dim(relative(cwd, dir))}`);
  }

  s.start("Building components...");

  const items: RegistryItem[] = [];
  const errors: { dir: string; error: string }[] = [];

  for (const dir of componentDirs) {
    try {
      const item = await buildComponent(dir);
      items.push(item);
    } catch (err: any) {
      errors.push({ dir: relative(cwd, dir), error: err.message });
    }
  }

  if (errors.length > 0) {
    s.stop(pc.red(`Build failed with ${errors.length} error(s)`));
    for (const { dir, error } of errors) {
      p.log.error(`${pc.bold(dir)}: ${error}`);
    }
    process.exit(1);
  }

  const { written, skipped } = await writeRegistryOutput(outputDir, items);

  s.stop(pc.green(`Built ${items.length} component(s)`));

  if (written.length > 0) {
    p.log.success(`Wrote ${written.length} file(s):`);
    for (const f of written) {
      p.log.message(`  ${pc.green("+")} ${f}`);
    }
  }

  if (skipped.length > 0) {
    p.log.info(`Skipped ${skipped.length} file(s) (already exist):`);
    for (const f of skipped) {
      p.log.message(`  ${pc.dim("-")} ${f}`);
    }
  }

  p.outro(`Output: ${pc.cyan(relative(cwd, outputDir) || ".")}`);
}
