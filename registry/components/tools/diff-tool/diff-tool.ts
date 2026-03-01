import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

function computeDiff(a: string, b: string): { added: number; removed: number; unchanged: number; diff: string } {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const output: string[] = [];
  let added = 0, removed = 0, unchanged = 0;

  // Simple LCS-based diff
  const lcs = Array.from({ length: aLines.length + 1 }, () => new Array(bLines.length + 1).fill(0));
  for (let i = aLines.length - 1; i >= 0; i--)
    for (let j = bLines.length - 1; j >= 0; j--)
      lcs[i][j] = aLines[i] === bLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  let i = 0, j = 0;
  while (i < aLines.length || j < bLines.length) {
    if (i < aLines.length && j < bLines.length && aLines[i] === bLines[j]) {
      output.push(` ${aLines[i]}`);
      unchanged++;
      i++; j++;
    } else if (j < bLines.length && (i >= aLines.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      output.push(`+${bLines[j]}`);
      added++;
      j++;
    } else {
      output.push(`-${aLines[i]}`);
      removed++;
      i++;
    }
  }
  return { added, removed, unchanged, diff: output.join("\n") };
}

export const diffTool = tool({
  description: "Compute the diff between two text strings, showing additions and removals in unified diff format",
  inputSchema: z.object({
    original: z.string().describe("Original text"),
    modified: z.string().describe("Modified text"),
  }),
  execute: async ({ original, modified }) => computeDiff(original, modified),
});

registerTool({
  name: "diff-tool",
  description: "Compute the diff between two text strings, showing additions and removals in unified diff format",
  inputSchema: z.object({ original: z.string(), modified: z.string() }),
  tool: diffTool,
});
