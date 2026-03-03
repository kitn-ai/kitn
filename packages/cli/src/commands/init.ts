import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  initProject,
  detectFramework,
  readConfig,
  VALID_FRAMEWORKS,
  type Framework,
} from "@kitnai/cli-core";
import { addCommand } from "./add.js";
import {
  fetchRulesConfig,
  generateRulesFiles,
} from "../installers/rules-generator.js";

interface InitOptions {
  runtime?: string;
  framework?: string;
  base?: string;
  yes?: boolean;
}

export async function initCommand(opts: InitOptions = {}) {
  p.intro(pc.bgCyan(pc.black(" kitn init ")));

  const cwd = process.cwd();

  const existing = await readConfig(cwd);
  if (existing) {
    if (opts.yes) {
      p.log.warn("kitn.json already exists — overwriting (--yes).");
    } else {
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
  }

  // --- Resolve runtime ---
  let runtime: string;
  if (opts.runtime) {
    if (!["bun", "node", "deno"].includes(opts.runtime)) {
      p.log.error(`Invalid runtime: ${opts.runtime}. Must be bun, node, or deno.`);
      process.exit(1);
    }
    runtime = opts.runtime;
  } else if (opts.yes) {
    runtime = "bun";
  } else {
    const selected = await p.select({
      message: "Which runtime do you use?",
      options: [
        { value: "bun", label: "Bun", hint: "recommended" },
        { value: "node", label: "Node.js" },
        { value: "deno", label: "Deno" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
    runtime = selected as string;
  }

  // --- Resolve framework ---
  let framework: Framework;
  const detected = await detectFramework(cwd);
  if (opts.framework) {
    if (!VALID_FRAMEWORKS.includes(opts.framework as Framework)) {
      p.log.error(`Invalid framework: ${opts.framework}. Must be one of: ${VALID_FRAMEWORKS.join(", ")}`);
      process.exit(1);
    }
    framework = opts.framework as Framework;
  } else if (detected) {
    framework = detected;
    p.log.info(`Detected ${pc.bold(detected)} from package.json`);
    if (!opts.yes) {
      const confirm = await p.confirm({
        message: `Use ${detected}?`,
        initialValue: true,
      });
      if (p.isCancel(confirm)) {
        p.cancel("Init cancelled.");
        process.exit(0);
      }
      if (!confirm) {
        const selected = await p.select({
          message: "Which HTTP framework do you use?",
          options: [
            { value: "hono", label: "Hono" },
            { value: "hono-openapi", label: "Hono + OpenAPI", hint: "zod-openapi routes with /doc endpoint" },
            { value: "elysia", label: "Elysia", hint: "Bun-native framework" },
          ],
        });
        if (p.isCancel(selected)) {
          p.cancel("Init cancelled.");
          process.exit(0);
        }
        framework = selected as Framework;
      }
    }
  } else if (opts.yes) {
    framework = "hono";
  } else {
    const selected = await p.select({
      message: "Which HTTP framework do you use?",
      options: [
        { value: "hono", label: "Hono", hint: "recommended" },
        { value: "hono-openapi", label: "Hono + OpenAPI", hint: "zod-openapi routes with /doc endpoint" },
        { value: "elysia", label: "Elysia", hint: "Bun-native framework" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
    framework = selected as Framework;
  }

  // --- Resolve base dir ---
  let baseDir: string;
  if (opts.base) {
    baseDir = opts.base;
  } else if (opts.yes) {
    baseDir = "src/ai";
  } else {
    const base = await p.text({
      message: "Where should kitn components be installed?",
      initialValue: "src/ai",
      placeholder: "src/ai",
    });
    if (p.isCancel(base)) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
    baseDir = base as string;
  }

  // --- Call cli-core initProject ---
  const s = p.spinner();
  s.start("Writing kitn.json");

  let result;
  try {
    result = await initProject({ cwd, runtime, framework, baseDir });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop("Created kitn.json");
  p.log.info(`Patched tsconfig.json with path: ${pc.bold("@kitn/*")}`);

  // Auto-install core engine + framework adapter
  p.log.info("Installing core engine and adapter...");
  await addCommand(["core", "routes"], { overwrite: true });

  p.log.success(`Created ${pc.bold(baseDir + "/plugin.ts")} — configure your AI provider there`);

  // --- Generate AI coding tool rules files ---
  try {
    const config = result.config;
    const rulesConfig = await fetchRulesConfig(config.registries);

    let selectedToolIds: string[];

    if (opts.yes) {
      selectedToolIds = rulesConfig.tools.map((t) => t.id);
    } else {
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
        selectedToolIds = [];
      } else {
        selectedToolIds = selected as string[];
      }
    }

    if (selectedToolIds.length > 0) {
      const written = await generateRulesFiles(cwd, config, selectedToolIds);
      for (const filePath of written) {
        p.log.success(`Created ${pc.bold(filePath)}`);
      }
    }
  } catch {
    p.log.warn("Could not generate AI coding tool rules (non-fatal).");
  }

  const mountCode = framework === "elysia"
    ? `app.use(new Elysia({ prefix: "/api" }).use(ai.router));`
    : `app.route("/api", ai.router);`;
  p.note(
    [
      `import { ai } from "@kitn/plugin";`,
      ``,
      mountCode,
    ].join("\n"),
    "Add this to your server entry point:",
  );

  p.log.message(
    [
      pc.bold("Add your first agent:"),
      `  ${pc.cyan("kitn add weather-agent")}`,
      "",
      pc.bold("Browse all components:"),
      `  ${pc.cyan("kitn list")}`,
    ].join("\n"),
  );

  p.outro("Done!");
}
