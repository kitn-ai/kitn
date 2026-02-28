import * as p from "@clack/prompts";
import pc from "picocolors";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { readConfig, writeConfig } from "../utils/config.js";
import { patchProjectTsconfig } from "../installers/tsconfig-patcher.js";
import { createBarrelFile } from "../installers/barrel-manager.js";
import { addCommand } from "./add.js";

function getPluginTemplate(framework: string): string {
  const adapterName = framework === "hono-openapi" ? "hono-openapi" : framework;
  return `import { createAIPlugin } from "@kitn/adapters/${adapterName}";
import { registerWithPlugin } from "./index.js";

export const ai = createAIPlugin({
  // To enable agent chat, add an AI provider:
  // https://sdk.vercel.ai/providers/ai-sdk-providers
  //
  // Example with OpenRouter (access to many models):
  //   import { openrouter } from "@openrouter/ai-sdk-provider";
  //   model: (id) => openrouter(id ?? "openai/gpt-4o-mini"),
  //
  // Example with OpenAI directly:
  //   import { openai } from "@ai-sdk/openai";
  //   model: (id) => openai(id ?? "gpt-4o-mini"),
});

// Flush all auto-registered components into the plugin
registerWithPlugin(ai);
`;
}

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

  const validFrameworks = ["hono", "hono-openapi", "elysia"] as const;
  type Framework = (typeof validFrameworks)[number];
  let framework: Framework;
  if (opts.framework) {
    if (!validFrameworks.includes(opts.framework as Framework)) {
      p.log.error(`Invalid framework: ${opts.framework}. Must be one of: ${validFrameworks.join(", ")}`);
      process.exit(1);
    }
    framework = opts.framework as Framework;
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
  const config = {
    runtime: runtime as "bun" | "node" | "deno",
    framework,
    aliases: {
      base: baseDir,
      agents: `${baseDir}/agents`,
      tools: `${baseDir}/tools`,
      skills: `${baseDir}/skills`,
      storage: `${baseDir}/storage`,
    },
    registries: {
      "@kitn": {
        url: "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
        homepage: "https://kitn.ai",
        description: "Official kitn AI agent components",
      },
    },
  };

  const s = p.spinner();
  s.start("Writing kitn.json");
  await writeConfig(cwd, config);
  s.stop("Created kitn.json");

  // Set up wildcard tsconfig path so @kitn/core, @kitn/adapters/*, etc. all resolve.
  // Remove any old per-package entries (e.g. @kitnai/core, @kitn/core) left from earlier versions.
  await patchProjectTsconfig(
    cwd,
    { "@kitn/*": [`./${baseDir}/*`] },
    ["@kitn", "@kitnai"],
  );
  p.log.info(`Patched tsconfig.json with path: ${pc.bold("@kitn/*")}`);

  // Auto-install core engine + framework adapter
  p.log.info("Installing core engine and adapter...");
  await addCommand(["core", "routes"], { overwrite: true });

  // Generate plugin.ts and barrel index.ts
  const aiDir = join(cwd, baseDir);
  await mkdir(aiDir, { recursive: true });

  const barrelPath = join(aiDir, "index.ts");
  await writeFile(barrelPath, createBarrelFile());

  const pluginPath = join(aiDir, "plugin.ts");
  await writeFile(pluginPath, getPluginTemplate(framework));

  p.log.success(`Created ${pc.bold(baseDir + "/plugin.ts")} — configure your AI provider there`);

  const mountCode = framework === "elysia"
    ? `app.use(ai.router);`
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
