import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readConfig, writeConfig } from "../config/io.js";
import { DEFAULT_REGISTRY_URL } from "../types/config.js";
import type { KitnConfig } from "../types/config.js";
import { patchTsconfig } from "../installers/tsconfig-patcher.js";
import { createBarrelFile } from "../installers/barrel-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_RUNTIMES = ["bun", "node", "deno"] as const;
export type Runtime = (typeof VALID_RUNTIMES)[number];

export const VALID_FRAMEWORKS = ["hono", "hono-openapi", "elysia"] as const;
export type Framework = (typeof VALID_FRAMEWORKS)[number];

export interface InitProjectOpts {
  cwd: string;
  runtime: string;
  framework: string;
  baseDir?: string;
}

export interface InitResult {
  configPath: string;
  config: KitnConfig;
  filesCreated: string[];
  detectedFramework?: string;
  pluginTemplate: string;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

/**
 * Detect the HTTP framework from the project's package.json dependencies.
 */
export async function detectFramework(cwd: string): Promise<Framework | null> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["elysia"]) return "elysia";
    if (deps["@hono/zod-openapi"]) return "hono-openapi";
    if (deps["hono"]) return "hono";
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate the plugin.ts template for a given framework.
 */
export function getPluginTemplate(framework: string): string {
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

// ---------------------------------------------------------------------------
// Main: initProject
// ---------------------------------------------------------------------------

/**
 * Initialize a kitn project: write kitn.json, patch tsconfig, create barrel + plugin files.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * The caller is responsible for:
 * - Prompting for runtime, framework, base dir (or passing them in opts)
 * - Detecting existing config and prompting for overwrite
 * - Calling addComponents for core + routes after init
 * - Rules file generation
 * - Output formatting
 */
export async function initProject(opts: InitProjectOpts): Promise<InitResult> {
  const { cwd, runtime, framework, baseDir: baseDirOpt } = opts;

  // Validate runtime
  if (!VALID_RUNTIMES.includes(runtime as Runtime)) {
    throw new Error(`Invalid runtime: "${runtime}". Must be one of: ${VALID_RUNTIMES.join(", ")}`);
  }

  // Validate framework
  if (!VALID_FRAMEWORKS.includes(framework as Framework)) {
    throw new Error(`Invalid framework: "${framework}". Must be one of: ${VALID_FRAMEWORKS.join(", ")}`);
  }

  const baseDir = baseDirOpt ?? "src/ai";

  const config: KitnConfig = {
    runtime: runtime as Runtime,
    framework: framework as Framework,
    aliases: {
      base: baseDir,
      agents: `${baseDir}/agents`,
      tools: `${baseDir}/tools`,
      skills: `${baseDir}/skills`,
      storage: `${baseDir}/storage`,
    },
    registries: {
      "@kitn": {
        url: DEFAULT_REGISTRY_URL,
        homepage: "https://kitn.ai",
        description: "Official kitn AI agent components",
      },
    },
  };

  const filesCreated: string[] = [];

  // Write kitn.json
  await writeConfig(cwd, config);
  filesCreated.push("kitn.json");

  // Patch tsconfig.json
  const tsconfigPath = join(cwd, "tsconfig.json");
  let tsconfigContent: string;
  try {
    tsconfigContent = await readFile(tsconfigPath, "utf-8");
  } catch {
    tsconfigContent = "{}";
  }
  const patchedTsconfig = patchTsconfig(
    tsconfigContent,
    { "@kitn/*": [`./${baseDir}/*`] },
    ["@kitn", "@kitnai"],
  );
  await writeFile(tsconfigPath, patchedTsconfig);
  filesCreated.push("tsconfig.json");

  // Create barrel file and plugin.ts
  const aiDir = join(cwd, baseDir);
  await mkdir(aiDir, { recursive: true });

  const barrelPath = join(aiDir, "index.ts");
  await writeFile(barrelPath, createBarrelFile());
  filesCreated.push(`${baseDir}/index.ts`);

  const pluginPath = join(aiDir, "plugin.ts");
  const pluginTemplate = getPluginTemplate(framework);
  await writeFile(pluginPath, pluginTemplate);
  filesCreated.push(`${baseDir}/plugin.ts`);

  return {
    configPath: join(cwd, "kitn.json"),
    config,
    filesCreated,
    pluginTemplate,
  };
}
