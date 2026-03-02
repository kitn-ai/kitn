import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removeComponent } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerRemoveTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_remove",
    {
      description: "Remove an installed component from the project",
      inputSchema: {
        component: z
          .string()
          .describe("Component name to remove (e.g. 'weather-agent')"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await removeComponent({ component, cwd });
        return {
          content: [{ type: "text", text: JSON.stringify({
            removed: result.removed.name,
            filesDeleted: result.removed.files.length,
            orphans: result.orphans,
            barrelUpdated: result.barrelUpdated,
          }, null, 2) }],
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
