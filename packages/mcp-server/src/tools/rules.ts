import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { regenerateRules } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerRulesTool(server: McpServer) {
  registerTool<{ cwd: string; toolIds?: string[] }>(
    server,
    "kitn_rules",
    {
      description:
        "Generate or regenerate AI coding rules files (AGENTS.md, .cursor/rules, etc.)",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        toolIds: z
          .array(z.string())
          .optional()
          .describe(
            "Tool IDs to generate rules for (e.g. ['claude-code', 'cursor']). Generates all if omitted.",
          ),
      },
    },
    async ({ cwd, toolIds }) => {
      try {
        const written = await regenerateRules({ cwd, toolIds });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ filesWritten: written }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
