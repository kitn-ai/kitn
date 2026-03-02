import * as p from "@clack/prompts";
import pc from "picocolors";
import { getRulesConfig } from "@kitnai/cli-core";
import { regenerateRules } from "../installers/rules-generator.js";

export async function rulesCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn rules ")));

  const cwd = process.cwd();

  const rulesConfig = await getRulesConfig(cwd);

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

  const written = await regenerateRules({
    cwd,
    toolIds: selectedIds,
  });

  s.stop("Rules files generated");

  for (const filePath of written) {
    p.log.success(`${pc.green("+")} ${filePath}`);
  }

  p.outro(`Generated ${written.length} rules file${written.length === 1 ? "" : "s"}.`);
}
