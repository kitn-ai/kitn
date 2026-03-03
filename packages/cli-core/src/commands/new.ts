import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, relative, basename } from "path";
import { fileURLToPath } from "url";
import { initProject, type InitResult } from "./init.js";
import { addComponents } from "./add.js";
import { resolveRoutesAlias } from "../types/config.js";
import { generateRulesFiles } from "./rules.js";

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
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a template directory.
 *
 * Strategy: walk up from this file's directory until we find a directory
 * containing `templates/<name>/package.json`. Works in:
 * - Dev: bun runs from source, walks up to repo root
 * - Dist: templates are copied to dist/templates/ during build
 */
async function resolveTemplatePath(templateName: string): Promise<string> {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = join(thisFile, "..");

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "templates", templateName);
    try {
      const s = await stat(join(candidate, "package.json"));
      if (s.isFile()) return candidate;
    } catch {
      // not found, keep walking
    }
    const parent = join(dir, "..");
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  throw new Error(
    `Could not find template "${templateName}". Looked for templates/${templateName}/package.json`,
  );
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
  const { targetDir, framework: templateName = "hono", runtime = "bun" } = opts;
  let { name } = opts;

  // Validate template
  if (!VALID_TEMPLATES.includes(templateName as Template)) {
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

  // Copy template
  const templatePath = await resolveTemplatePath(templateName);
  const replacements = { "{{name}}": name };
  const filesCreated = await copyDir(templatePath, projectPath, replacements);

  // Map template name to framework value for initProject
  const framework = TEMPLATE_TO_FRAMEWORK[templateName] ?? templateName;

  // Run kitn init inside the new project
  const initResult = await initProject({
    cwd: projectPath,
    runtime,
    framework,
  });

  // Install core + routes adapter
  const routesAdapter = resolveRoutesAlias(initResult.config);
  const addResult = await addComponents({
    components: ["core", routesAdapter],
    cwd: projectPath,
    overwrite: true,
  });

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
}
