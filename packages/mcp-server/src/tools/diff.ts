import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { diffComponent } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerDiffTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_diff",
    {
      description:
        "Show differences between an installed component and the latest registry version",
      inputSchema: {
        component: z
          .string()
          .describe("Component name to diff (e.g. 'weather-agent')"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await diffComponent({ component, cwd });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
