import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";
import { detectPackageManager } from "../utils/detect.js";
import { installDependencies } from "../installers/dep-installer.js";

export async function initCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn ")));

  const cwd = process.cwd();

  const existing = await readConfig(cwd);
  if (existing) {
    p.log.warn("kitn.json already exists in this directory.");
    const shouldContinue = await p.confirm({
      message: "Overwrite existing configuration?",
      initialValue: false,
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
  }

  const runtime = await p.select({
    message: "Which runtime do you use?",
    options: [
      { value: "bun", label: "Bun", hint: "recommended" },
      { value: "node", label: "Node.js" },
      { value: "deno", label: "Deno" },
    ],
  });
  if (p.isCancel(runtime)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const aliases = await p.group({
    agents: () =>
      p.text({
        message: "Where should agents be installed?",
        initialValue: "src/agents",
        placeholder: "src/agents",
      }),
    tools: () =>
      p.text({
        message: "Where should tools be installed?",
        initialValue: "src/tools",
        placeholder: "src/tools",
      }),
    skills: () =>
      p.text({
        message: "Where should skills be installed?",
        initialValue: "src/skills",
        placeholder: "src/skills",
      }),
    storage: () =>
      p.text({
        message: "Where should storage adapters be installed?",
        initialValue: "src/storage",
        placeholder: "src/storage",
      }),
  });
  if (p.isCancel(aliases)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const config = {
    runtime: runtime as "bun" | "node" | "deno",
    aliases: {
      agents: aliases.agents as string,
      tools: aliases.tools as string,
      skills: aliases.skills as string,
      storage: aliases.storage as string,
    },
    registries: {
      "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
    },
  };

  const s = p.spinner();

  s.start("Writing kitn.json");
  await writeConfig(cwd, config);
  s.stop("Created kitn.json");

  const pm = await detectPackageManager(cwd);
  if (pm) {
    const shouldInstall = await p.confirm({
      message: `Install @kitnai/hono using ${pm}?`,
      initialValue: true,
    });
    if (!p.isCancel(shouldInstall) && shouldInstall) {
      s.start("Installing @kitnai/hono...");
      try {
        installDependencies(pm, ["@kitnai/hono"], cwd);
        s.stop("Installed @kitnai/hono");
      } catch {
        s.stop(pc.yellow("Failed to install @kitnai/hono — you can install it manually"));
      }
    }
  } else {
    p.log.info("No package manager detected. Install @kitnai/hono manually.");
  }

  p.outro(pc.green("Done! Run `kitn add <component>` to add your first component."));
}
