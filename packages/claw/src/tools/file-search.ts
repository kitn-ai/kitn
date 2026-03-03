import { tool } from "ai";
import { z } from "zod";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

export const fileSearchTool = tool({
  description: "Search for files by name pattern (glob) and optionally search content with a regex pattern",
  inputSchema: z.object({
    directory: z.string().default(".").describe("Directory to search in"),
    pattern: z.string().optional().describe("Filename pattern to match (e.g. '*.ts', 'README*')"),
    contentPattern: z.string().optional().describe("Regex pattern to search within file contents"),
    maxResults: z.number().default(20).describe("Maximum number of results to return"),
    maxDepth: z.number().default(5).describe("Maximum directory depth to recurse"),
  }),
  execute: async ({ directory, pattern, contentPattern, maxResults, maxDepth }) => {
    const results: Array<{ path: string; matches?: string[] }> = [];
    const regex = pattern ? globToRegex(pattern) : null;
    const contentRegex = contentPattern ? new RegExp(contentPattern, "gm") : null;

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth || results.length >= maxResults) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          await walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (regex && !regex.test(entry.name)) continue;

          if (contentRegex) {
            try {
              const content = await readFile(fullPath, "utf-8");
              const lineMatches: string[] = [];
              for (const line of content.split("\n")) {
                if (contentRegex.test(line)) {
                  lineMatches.push(line.trim());
                  if (lineMatches.length >= 5) break;
                }
                contentRegex.lastIndex = 0;
              }
              if (lineMatches.length > 0) {
                results.push({ path: relative(directory, fullPath), matches: lineMatches });
              }
            } catch {
              // skip binary/unreadable files
            }
          } else {
            results.push({ path: relative(directory, fullPath) });
          }
        }
      }
    }

    await walk(directory, 0);
    return { directory, resultCount: results.length, results };
  },
});

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
