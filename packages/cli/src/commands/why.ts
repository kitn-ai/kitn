import * as p from "@clack/prompts";
import pc from "picocolors";
import { whyComponent } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function whyCommand(component: string) {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await whyComponent({ component, cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  if (!result.found) {
    p.log.error(`Component "${component}" is not installed.`);
    process.exit(1);
  }

  if (result.isTopLevel) {
    p.log.info(
      `${pc.bold(component)} is a top-level install (not a dependency of any other component).`,
    );
    return;
  }

  // Show direct dependents
  p.log.info(
    `${pc.bold(component)} is required by:\n` +
      result.dependents.map((d) => `  ${pc.cyan("\u2190")} ${d}`).join("\n"),
  );

  // Show dependency chains
  if (result.chains.length > 0) {
    console.log();
    p.log.info("Dependency chain(s):");
    for (const chain of result.chains) {
      const formatted = chain.map((c, i) => {
        if (c === component) return pc.bold(c);
        return c;
      }).join(pc.dim(" \u2192 "));
      console.log(`  ${formatted}`);
    }
  }
}
