import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, relative, basename } from "path";
import { initProject, type InitResult } from "./init.js";
import { addComponents } from "./add.js";
import { resolveRoutesAlias } from "../types/config.js";
import { generateRulesFiles } from "./rules.js";
import { PROVIDERS, VALID_PROVIDERS } from "./providers.js";
import {
  fetchBuiltinTemplate,
  fetchCustomTemplate,
} from "../templates/fetcher.js";
export type { ProviderDef } from "./providers.js";
export { PROVIDERS, VALID_PROVIDERS } from "./providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_TEMPLATES = ["hono"] as const;
export type Template = (typeof VALID_TEMPLATES)[number];

/** Maps user-facing template name to the framework value used by initProject */
const TEMPLATE_TO_FRAMEWORK: Record<string, string> = {
  hono: "hono-openapi",
};

export interface NewProjectOpts {
  name: string;
  targetDir: string;
  framework?: string; // default: "hono"
  runtime?: string; // default: "bun"
  provider?: string; // default: "openrouter"
  apiKey?: string; // optional — writes .env with real key
  template?: string; // custom template URL (github:user/repo)
}

export interface NewProjectResult {
  projectPath: string;
  framework: string;
  runtime: string;
  filesCreated: string[];
  npmDeps: string[];
  npmDevDeps: string[];
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory, applying placeholder replacements to file contents.
 */
async function copyDir(
  src: string,
  dest: string,
  replacements: Record<string, string>,
): Promise<string[]> {
  const created: string[] = [];
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = await copyDir(srcPath, destPath, replacements);
      created.push(...sub);
    } else {
      let content = await readFile(srcPath, "utf-8");
      for (const [placeholder, value] of Object.entries(replacements)) {
        content = content.replaceAll(placeholder, value);
      }
      await writeFile(destPath, content);
      created.push(destPath);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Main: newProject
// ---------------------------------------------------------------------------

export async function newProject(
  opts: NewProjectOpts,
): Promise<NewProjectResult> {
  const {
    targetDir,
    framework: templateName = "hono",
    runtime = "bun",
    provider: providerKey = "openrouter",
    apiKey,
    template: customTemplate,
  } = opts;
  let { name } = opts;

  const isCustom = !!customTemplate;

  // Validate provider (only for built-in templates)
  const providerDef = !isCustom ? PROVIDERS[providerKey] : undefined;
  if (!isCustom && !providerDef) {
    throw new Error(
      `Unknown provider: "${providerKey}". Available: ${VALID_PROVIDERS.join(", ")}`,
    );
  }

  // Validate template (only for built-in templates)
  if (!isCustom && !VALID_TEMPLATES.includes(templateName as Template)) {
    throw new Error(
      `Unknown template: "${templateName}". Available: ${VALID_TEMPLATES.join(", ")}`,
    );
  }

  let projectPath: string;

  if (name === ".") {
    // Create in current directory
    projectPath = targetDir;
    name = basename(targetDir);

    // Check directory is empty (allow .git, .gitignore, etc.)
    const SAFE_FILES = new Set([".git", ".gitignore", ".DS_Store"]);
    try {
      const entries = await readdir(projectPath);
      const nonSafe = entries.filter((e) => !SAFE_FILES.has(e));
      if (nonSafe.length > 0) {
        throw new Error(
          `Directory is not empty. Found: ${nonSafe.slice(0, 5).join(", ")}${nonSafe.length > 5 ? "..." : ""}`,
        );
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // Directory doesn't exist yet — that's fine, mkdir will create it
      } else if (err.message?.startsWith("Directory is not empty")) {
        throw err;
      }
      // Other errors: let copyDir handle them
    }
  } else {
    projectPath = join(targetDir, name);

    // Check target doesn't exist
    try {
      await stat(projectPath);
      throw new Error(`Directory "${name}" already exists in ${targetDir}`);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  // Fetch template (GitHub with local fallback for built-in, GitHub-only for custom)
  const fetched = isCustom
    ? await fetchCustomTemplate(customTemplate)
    : await fetchBuiltinTemplate(templateName);

  try {
    // Copy template with placeholder replacements (empty for custom templates)
    const replacements: Record<string, string> = isCustom
      ? { "{{name}}": name }
      : {
          "{{name}}": name,
          "{{provider_package}}": providerDef!.package,
          "{{provider_package_version}}": providerDef!.packageVersion,
          "{{provider_import}}": providerDef!.importStatement,
          "{{provider_call}}": providerDef!.providerCall,
          "{{api_key_env}}": providerDef!.envVar,
          "{{api_key_placeholder}}": providerDef!.envPlaceholder,
          "{{api_key_url}}": providerDef!.envUrl,
          "{{default_model}}": providerDef!.defaultModel,
        };
    const filesCreated = await copyDir(fetched.dir, projectPath, replacements);

    // Create .env from .env.example (only for built-in templates)
    if (!isCustom) {
      const envExamplePath = join(projectPath, ".env.example");
      const envPath = join(projectPath, ".env");
      try {
        let envContent = await readFile(envExamplePath, "utf-8");
        if (apiKey) {
          envContent = envContent.replace(providerDef!.envPlaceholder, apiKey);
        }
        await writeFile(envPath, envContent);
        filesCreated.push(envPath);
      } catch {
        // .env.example might not exist for some templates — skip
      }
    }

    // Map template name to framework value for initProject
    const framework = isCustom
      ? templateName
      : (TEMPLATE_TO_FRAMEWORK[templateName] ?? templateName);

    // Run kitn init inside the new project
    const initResult = await initProject({
      cwd: projectPath,
      runtime,
      framework,
      provider: providerKey,
    });

    // Install core + routes adapter
    const routesAdapter = resolveRoutesAlias(initResult.config);
    const addResult = await addComponents({
      components: ["core", routesAdapter],
      cwd: projectPath,
      overwrite: true,
    });

    // Replace the stub src/ai.ts with a re-export from the real plugin.
    // The template ships a stub (empty router) so the app compiles before
    // kitn init runs. Now that init has created src/ai/plugin.ts, wire it up.
    const stubPath = join(projectPath, "src", "ai.ts");
    try {
      await writeFile(
        stubPath,
        `export { ai } from "./ai/plugin.js";\n`,
      );
    } catch {
      // Template may not have the stub — skip
    }

    // Generate rules files (all tools, non-interactive)
    try {
      await generateRulesFiles(projectPath, initResult.config);
    } catch {
      // Non-fatal — rules are a nice-to-have
    }

    return {
      projectPath,
      framework: templateName,
      runtime,
      filesCreated: filesCreated.map((f) => relative(projectPath, f)),
      npmDeps: addResult.npmDeps,
      npmDevDeps: addResult.npmDevDeps,
    };
  } finally {
    await fetched.cleanup();
  }
}
