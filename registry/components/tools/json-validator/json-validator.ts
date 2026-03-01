import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const jsonValidatorTool = tool({
  description: "Validate JSON syntax, pretty-print, or minify JSON strings",
  inputSchema: z.object({
    json: z.string().describe("JSON string to validate/format"),
    action: z.enum(["validate", "prettify", "minify"]).default("validate").describe("Action to perform"),
  }),
  execute: async ({ json, action }) => {
    try {
      const parsed = JSON.parse(json);
      switch (action) {
        case "validate":
          return { valid: true, type: Array.isArray(parsed) ? "array" : typeof parsed, keys: typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : undefined };
        case "prettify":
          return { valid: true, formatted: JSON.stringify(parsed, null, 2) };
        case "minify":
          return { valid: true, minified: JSON.stringify(parsed), originalLength: json.length, minifiedLength: JSON.stringify(parsed).length };
      }
    } catch (e) {
      const error = e as SyntaxError;
      return { valid: false, error: error.message };
    }
  },
});

registerTool({
  name: "json-validator",
  description: "Validate JSON syntax, pretty-print, or minify JSON strings",
  inputSchema: z.object({
    json: z.string(),
    action: z.enum(["validate", "prettify", "minify"]).default("validate"),
  }),
  tool: jsonValidatorTool,
});
