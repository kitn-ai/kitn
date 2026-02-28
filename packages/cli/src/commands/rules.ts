import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, DEFAULT_REGISTRIES, DEFAULT_ALIASES } from "../utils/config.js";
import {
  fetchRulesConfig,
  generateRulesFiles,
} from "../installers/rules-generator.js";
import type { KitnConfig } from "../utils/config.js";

export async function rulesCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn rules ")));

  const cwd = process.cwd();
  const config = await readConfig(cwd);

  // Use project aliases if kitn.json exists, otherwise defaults
  const registries = config?.registries ?? DEFAULT_REGISTRIES;
  const aliases = config?.aliases ?? DEFAULT_ALIASES;

  const rulesConfig = await fetchRulesConfig(registries);

  const selected = await p.multiselect({
    message: "Which AI coding tools do you use?",
    options: rulesConfig.tools.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.description,
    })),
    required: false,
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const selectedIds = selected as string[];

  if (selectedIds.length === 0) {
    p.log.warn("No tools selected. Nothing to generate.");
    p.outro("Done.");
    return;
  }

  const s = p.spinner();
  s.start("Generating rules files");

  // Build a minimal config-like object for generateRulesFiles
  const effectiveConfig = { registries, aliases } as KitnConfig;

  const written = await generateRulesFiles(cwd, effectiveConfig, selectedIds);

  s.stop("Rules files generated");

  for (const filePath of written) {
    p.log.success(`${pc.green("+")} ${filePath}`);
  }

  p.outro(`Generated ${written.length} rules file${written.length === 1 ? "" : "s"}.`);
}
