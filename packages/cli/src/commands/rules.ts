import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";
import {
  fetchRulesConfig,
  generateRulesFiles,
} from "../installers/rules-generator.js";

export async function rulesCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn rules ")));

  const cwd = process.cwd();
  const config = await readConfig(cwd);

  if (!config) {
    p.log.error(`No kitn.json found. Run ${pc.bold("kitn init")} first.`);
    process.exit(1);
  }

  let selectedIds = config.aiTools;

  // If no aiTools saved in config, prompt user to select
  if (!selectedIds || selectedIds.length === 0) {
    const rulesConfig = await fetchRulesConfig(config.registries);

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

    selectedIds = selected as string[];

    if (selectedIds.length === 0) {
      p.log.warn("No tools selected. Nothing to generate.");
      p.outro("Done.");
      return;
    }

    // Save selections to kitn.json
    const updatedConfig = { ...config, aiTools: selectedIds };
    await writeConfig(cwd, updatedConfig);
    p.log.info(`Saved tool selections to ${pc.bold("kitn.json")}`);
  }

  const s = p.spinner();
  s.start("Generating rules files");

  const written = await generateRulesFiles(cwd, config, selectedIds);

  s.stop("Rules files generated");

  for (const filePath of written) {
    p.log.success(`${pc.green("+")} ${filePath}`);
  }

  p.outro(`Generated ${written.length} rules file${written.length === 1 ? "" : "s"}.`);
}
