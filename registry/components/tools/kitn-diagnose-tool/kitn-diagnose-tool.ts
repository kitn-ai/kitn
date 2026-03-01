import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

interface KitnConfig {
  runtime?: string;
  aliases?: Record<string, string>;
  registries?: Record<string, string>;
}

interface LockEntry {
  type: string;
  version: string;
  installedAt: string;
  files: string[];
  hash: string;
}

interface DiagnosticIssue {
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  file?: string;
  fix?: string;
}

function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function listFiles(dir: string, ext?: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, ext));
    } else if (!ext || entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkImports(
  filePath: string,
  projectRoot: string
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const importMatch = line.match(
        /(?:import|from)\s+['"](@kitnai\/[^'"]+)['"]/
      );
      if (importMatch) {
        issues.push({
          severity: "error",
          category: "import",
          message: `Wrong import scope: "${importMatch[1]}" — user projects should use "@kitn/" not "@kitnai/"`,
          file: filePath.replace(projectRoot + "/", ""),
          fix: `Change "${importMatch[1]}" to "${importMatch[1].replace("@kitnai/", "@kitn/")}"`,
        });
      }

      // Check for missing .js extension in relative imports
      const relativeMatch = line.match(
        /(?:import|from)\s+['"](\.[^'"]+)['"]/
      );
      if (relativeMatch && !relativeMatch[1].endsWith(".js")) {
        issues.push({
          severity: "warning",
          category: "import",
          message: `Relative import missing .js extension: "${relativeMatch[1]}"`,
          file: filePath.replace(projectRoot + "/", ""),
          fix: `Add .js extension: "${relativeMatch[1]}.js"`,
        });
      }
    }
  } catch {
    // File unreadable — handled elsewhere
  }
  return issues;
}

export const kitnDiagnoseTool = tool({
  description:
    "Diagnose issues in a kitn project. Reads kitn.json, kitn.lock, and installed component files to find problems like missing files, broken imports, stale lock entries, and configuration issues.",
  inputSchema: z.object({
    projectPath: z
      .string()
      .describe(
        "Absolute path to the kitn project root (directory containing kitn.json)"
      ),
    checks: z
      .array(
        z.enum(["config", "lock", "files", "imports", "dependencies", "all"])
      )
      .default(["all"])
      .describe(
        "Which checks to run. 'all' runs everything. Options: config, lock, files, imports, dependencies"
      ),
  }),
  execute: async ({ projectPath, checks }) => {
    const root = resolve(projectPath);
    const issues: DiagnosticIssue[] = [];
    const runAll = checks.includes("all");

    // Check kitn.json exists and is valid
    const configPath = join(root, "kitn.json");
    let config: KitnConfig | null = null;

    if (runAll || checks.includes("config")) {
      if (!existsSync(configPath)) {
        issues.push({
          severity: "error",
          category: "config",
          message: "kitn.json not found in project root",
          fix: "Run 'kitn init' to create a kitn.json",
        });
      } else {
        config = readJsonFile(configPath) as KitnConfig | null;
        if (!config) {
          issues.push({
            severity: "error",
            category: "config",
            message: "kitn.json is not valid JSON",
            file: "kitn.json",
            fix: "Fix the JSON syntax in kitn.json",
          });
        } else {
          if (!config.aliases) {
            issues.push({
              severity: "warning",
              category: "config",
              message:
                "kitn.json has no aliases configured — components won't know where to install",
              file: "kitn.json",
              fix: 'Add aliases: { "agents": "src/agents", "tools": "src/tools", ... }',
            });
          }
          if (!config.registries) {
            issues.push({
              severity: "info",
              category: "config",
              message: "No custom registries configured — using default kitn registry",
              file: "kitn.json",
            });
          }
        }
      }
    }

    // Check kitn.lock
    const lockPath = join(root, "kitn.lock");
    let lock: Record<string, LockEntry> | null = null;

    if (runAll || checks.includes("lock")) {
      if (!existsSync(lockPath)) {
        issues.push({
          severity: "info",
          category: "lock",
          message: "kitn.lock not found — no components have been installed yet",
        });
      } else {
        lock = readJsonFile(lockPath) as Record<string, LockEntry> | null;
        if (!lock) {
          issues.push({
            severity: "error",
            category: "lock",
            message: "kitn.lock is not valid JSON",
            file: "kitn.lock",
            fix: "Delete kitn.lock and reinstall components with 'kitn add'",
          });
        }
      }
    }

    // Check installed files exist
    if ((runAll || checks.includes("files")) && lock) {
      for (const [name, entry] of Object.entries(lock)) {
        for (const file of entry.files) {
          const filePath = join(root, file);
          if (!existsSync(filePath)) {
            issues.push({
              severity: "error",
              category: "files",
              message: `Installed file missing: ${file} (component: ${name})`,
              file,
              fix: `Reinstall with 'kitn add ${name}' or remove from kitn.lock`,
            });
          }
        }
      }
    }

    // Check imports in installed files
    if ((runAll || checks.includes("imports")) && lock && config?.aliases) {
      for (const [, entry] of Object.entries(lock)) {
        for (const file of entry.files) {
          const filePath = join(root, file);
          if (existsSync(filePath) && file.endsWith(".ts")) {
            issues.push(...checkImports(filePath, root));
          }
        }
      }
    }

    // Check package.json dependencies
    if (runAll || checks.includes("dependencies")) {
      const pkgPath = join(root, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = readJsonFile(pkgPath) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        } | null;
        if (pkg) {
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };

          if (!allDeps["@kitn/core"]) {
            issues.push({
              severity: "error",
              category: "dependencies",
              message: "@kitn/core is not in package.json dependencies",
              file: "package.json",
              fix: "Run 'npm install @kitn/core' or 'bun add @kitn/core'",
            });
          }
          if (!allDeps["ai"]) {
            issues.push({
              severity: "error",
              category: "dependencies",
              message:
                "'ai' (Vercel AI SDK) is not in package.json dependencies",
              file: "package.json",
              fix: "Run 'npm install ai' or 'bun add ai'",
            });
          }
        }
      }
    }

    // Build directory tree of the AI source directories
    const tree: Record<string, string[]> = {};
    if (config?.aliases) {
      for (const [type, dir] of Object.entries(config.aliases)) {
        const fullDir = join(root, dir);
        if (existsSync(fullDir)) {
          tree[type] = listFiles(fullDir, ".ts").map((f) =>
            f.replace(root + "/", "")
          );
        } else {
          tree[type] = [];
        }
      }
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    return {
      project: root,
      healthy: errorCount === 0,
      summary: `${errorCount} errors, ${warningCount} warnings, ${issues.length - errorCount - warningCount} info`,
      installedComponents: lock ? Object.keys(lock).length : 0,
      issues,
      tree,
    };
  },
});

registerTool({
  name: "kitn-diagnose-tool",
  description:
    "Diagnose issues in a kitn project — validates config, installed components, imports, and dependencies",
  inputSchema: z.object({
    projectPath: z.string(),
    checks: z
      .array(
        z.enum(["config", "lock", "files", "imports", "dependencies", "all"])
      )
      .default(["all"]),
  }),
  tool: kitnDiagnoseTool,
});
