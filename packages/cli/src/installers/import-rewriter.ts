import { relative, dirname, join, posix } from "path";

type AliasKey = "agents" | "tools" | "skills" | "storage" | "crons";

const KNOWN_TYPES: readonly AliasKey[] = ["agents", "tools", "skills", "storage", "crons"];

const TYPE_TO_ALIAS_KEY: Record<string, AliasKey> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
  "kitn:cron": "crons",
};

/**
 * Rewrites `@kitn/<type>/<path>` imports to relative paths based on install layout.
 *
 * Only rewrites known types (agents, tools, skills, storage).
 * Other `@kitn/` imports (e.g. `@kitn/server`) pass through untouched.
 */
export function rewriteKitnImports(
  content: string,
  fileType: string,
  fileName: string,
  aliases: Record<string, string | undefined>,
): string {
  const sourceAliasKey = TYPE_TO_ALIAS_KEY[fileType];
  if (!sourceAliasKey) return content;

  const sourceDir = aliases[sourceAliasKey];
  if (!sourceDir) return content;

  // Match import/export ... from "@kitn/<type>/<path>"
  return content.replace(
    /((?:import|export)\s+.*?\s+from\s+["'])@kitn\/([\w-]+)\/([^"']+)(["'])/g,
    (_match, prefix: string, type: string, targetPath: string, quote: string) => {
      if (!KNOWN_TYPES.includes(type as AliasKey)) {
        return `${prefix}@kitn/${type}/${targetPath}${quote}`;
      }

      const targetDir = aliases[type as AliasKey];
      if (!targetDir) {
        return `${prefix}@kitn/${type}/${targetPath}${quote}`;
      }
      const targetFile = join(targetDir, targetPath);
      let rel = relative(sourceDir, targetFile);

      // Normalize to posix separators
      rel = rel.split("\\").join("/");

      // Ensure relative path starts with ./ or ../
      if (!rel.startsWith(".")) {
        rel = `./${rel}`;
      }

      return `${prefix}${rel}${quote}`;
    },
  );
}
