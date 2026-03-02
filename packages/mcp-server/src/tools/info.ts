import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getComponentInfo } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerInfoTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_info",
    {
      description:
        "Get full details about a component — docs, files, dependencies, changelog",
      inputSchema: {
        component: z
          .string()
          .describe("Component name (e.g. 'weather-agent')"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await getComponentInfo({ component, cwd });
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
