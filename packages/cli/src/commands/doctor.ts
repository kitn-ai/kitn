import * as p from "@clack/prompts";
import pc from "picocolors";
import { doctorCheck } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

const STATUS_ICONS: Record<string, string> = {
  pass: pc.green("\u2713"),
  warn: pc.yellow("\u26A0"),
  fail: pc.red("\u2717"),
};

export async function doctorCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn doctor ")));

  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await doctorCheck({ cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  const MAX_DETAILS = 10;

  for (const check of result.checks) {
    const icon = STATUS_ICONS[check.status];
    const msg = check.status === "fail"
      ? pc.red(check.message)
      : check.status === "warn"
        ? pc.yellow(check.message)
        : check.message;

    console.log(`  ${icon} ${pc.bold(check.name)}: ${msg}`);

    if (check.details && check.details.length > 0) {
      const shown = check.details.slice(0, MAX_DETAILS);
      for (const detail of shown) {
        console.log(`    ${pc.dim("\u2502")} ${pc.dim(detail)}`);
      }
      if (check.details.length > MAX_DETAILS) {
        console.log(`    ${pc.dim("\u2502")} ${pc.dim(`... and ${check.details.length - MAX_DETAILS} more`)}`);
      }
    }
  }

  console.log();

  const parts: string[] = [];
  if (result.stats.pass > 0) parts.push(pc.green(`${result.stats.pass} passed`));
  if (result.stats.warn > 0) parts.push(pc.yellow(`${result.stats.warn} warning(s)`));
  if (result.stats.fail > 0) parts.push(pc.red(`${result.stats.fail} failed`));

  p.outro(parts.join(pc.dim(" \u00B7 ")));

  if (result.stats.fail > 0) {
    process.exit(1);
  }
}
