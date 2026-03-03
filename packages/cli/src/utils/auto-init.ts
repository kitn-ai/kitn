import { resolve } from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  readConfig,
  initProject,
  detectFramework,
  VALID_FRAMEWORKS,
  type KitnConfig,
  type Framework,
} from "@kitnai/cli-core";
import { addCommand } from "../commands/add.js";

interface RequireConfigResult {
  config: KitnConfig;
  cwd: string;
}

/**
 * Interactive init flow triggered when kitn.json is missing.
 * Returns { cwd, config } on success, or null if cancelled.
 */
async function promptAutoInit(
  originalCwd: string,
): Promise<RequireConfigResult | null> {
  p.log.warn(
    `No ${pc.bold("kitn.json")} found. Let's set up kitn first.`,
  );

  const where = await p.select({
    message: "Where should kitn be initialized?",
    options: [
      { value: "here", label: `Here (${originalCwd})` },
      { value: "other", label: "Different directory" },
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (p.isCancel(where) || where === "cancel") return null;

  let cwd = originalCwd;
  if (where === "other") {
    const dir = await p.text({
      message: "Enter the project directory:",
      placeholder: originalCwd,
    });
    if (p.isCancel(dir)) return null;
    cwd = resolve(dir as string);

    // Check if already initialized there
    const existing = await readConfig(cwd);
    if (existing) {
      p.log.info(`Found existing kitn.json in ${pc.bold(cwd)}`);
      return { config: existing, cwd };
    }
  }

  // --- Runtime ---
  const runtime = await p.select({
    message: "Which runtime do you use?",
    options: [
      { value: "bun", label: "Bun", hint: "recommended" },
      { value: "node", label: "Node.js" },
      { value: "deno", label: "Deno" },
    ],
  });
  if (p.isCancel(runtime)) return null;

  // --- Framework ---
  let framework: string;
  const detected = await detectFramework(cwd);
  if (detected) {
    p.log.info(`Detected ${pc.bold(detected)} from package.json`);
    const confirm = await p.confirm({
      message: `Use ${detected}?`,
      initialValue: true,
    });
    if (p.isCancel(confirm)) return null;
    if (confirm) {
      framework = detected;
    } else {
      const selected = await p.select({
        message: "Which HTTP framework do you use?",
        options: [
          { value: "hono", label: "Hono" },
          { value: "hono-openapi", label: "Hono + OpenAPI", hint: "zod-openapi routes with /doc endpoint" },
          { value: "elysia", label: "Elysia", hint: "Bun-native framework" },
        ],
      });
      if (p.isCancel(selected)) return null;
      framework = selected as string;
    }
  } else {
    const selected = await p.select({
      message: "Which HTTP framework do you use?",
      options: [
        { value: "hono", label: "Hono", hint: "recommended" },
        { value: "hono-openapi", label: "Hono + OpenAPI", hint: "zod-openapi routes with /doc endpoint" },
        { value: "elysia", label: "Elysia", hint: "Bun-native framework" },
      ],
    });
    if (p.isCancel(selected)) return null;
    framework = selected as string;
  }

  // --- Base dir ---
  const baseDir = await p.text({
    message: "Where should kitn components be installed?",
    initialValue: "src/ai",
    placeholder: "src/ai",
  });
  if (p.isCancel(baseDir)) return null;

  // --- Run init ---
  const s = p.spinner();
  s.start("Writing kitn.json");

  let result;
  try {
    result = await initProject({
      cwd,
      runtime: runtime as string,
      framework,
      baseDir: baseDir as string,
    });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    return null;
  }

  s.stop("Created kitn.json");
  p.log.info(`Patched tsconfig.json with path: ${pc.bold("@kitn/*")}`);

  // Auto-install core engine + framework adapter
  p.log.info("Installing core engine and adapter...");
  await addCommand(["core", "routes"], { overwrite: true });

  p.log.success(`Initialized kitn in ${pc.bold(cwd)}`);
  p.log.message(""); // blank line before continuing with original command

  return { config: result.config, cwd };
}

/**
 * Drop-in replacement for manual readConfig + error check.
 * Returns { config, cwd } — cwd may differ if the user chose a different directory.
 */
export async function requireConfig(
  cwd: string,
): Promise<RequireConfigResult> {
  const config = await readConfig(cwd);
  if (config) return { config, cwd };

  // Non-TTY (CI): hard error, no prompts
  if (!process.stdin.isTTY) {
    p.log.error('No kitn.json found. Run "kitn init" first.');
    process.exit(1);
  }

  const result = await promptAutoInit(cwd);
  if (!result) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return result;
}
