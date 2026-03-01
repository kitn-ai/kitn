import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const regexTesterTool = tool({
  description: "Test a regular expression pattern against text — find matches, extract groups, or perform replacements",
  inputSchema: z.object({
    pattern: z.string().describe("Regular expression pattern (without delimiters)"),
    flags: z.string().default("g").describe("Regex flags (g, i, m, s, u)"),
    text: z.string().describe("Text to test against"),
    action: z.enum(["test", "match", "replace"]).default("match").describe("Action to perform"),
    replacement: z.string().optional().describe("Replacement string (for replace action)"),
  }),
  execute: async ({ pattern, flags, text, action, replacement }) => {
    try {
      const regex = new RegExp(pattern, flags);
      switch (action) {
        case "test":
          return { matches: regex.test(text), pattern, flags };
        case "match": {
          const matches = [...text.matchAll(new RegExp(pattern, flags.includes("g") ? flags : flags + "g"))];
          return {
            matchCount: matches.length,
            matches: matches.map((m) => ({
              match: m[0],
              index: m.index,
              groups: m.groups ?? undefined,
              captures: m.slice(1),
            })),
          };
        }
        case "replace":
          return { original: text, result: text.replace(regex, replacement ?? ""), pattern, flags };
      }
    } catch (e) {
      return { error: `Invalid regex: ${(e as Error).message}` };
    }
  },
});

registerTool({
  name: "regex-tester",
  description: "Test a regular expression pattern against text — find matches, extract groups, or perform replacements",
  inputSchema: z.object({
    pattern: z.string(),
    flags: z.string().default("g"),
    text: z.string(),
    action: z.enum(["test", "match", "replace"]).default("match"),
    replacement: z.string().optional(),
  }),
  tool: regexTesterTool,
});
