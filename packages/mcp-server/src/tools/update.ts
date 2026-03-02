import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { updateComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerUpdateTool(server: McpServer) {
  registerTool<{ cwd: string; components?: string[] }>(
    server,
    "kitn_update",
    {
      description:
        "Update installed component(s) to the latest registry version. Updates all if no components specified.",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        components: z
          .array(z.string())
          .optional()
          .describe(
            "Component names to update (updates all installed if omitted)",
          ),
      },
    },
    async ({ cwd, components }) => {
      try {
        const result = await updateComponents({ cwd, components });
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
