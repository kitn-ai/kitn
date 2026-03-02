import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectContext } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerProjectTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_project",
    {
      description:
        "Get project context — kitn.json config, installed components, framework, runtime",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const context = await getProjectContext({ cwd });
        return {
          content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
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
