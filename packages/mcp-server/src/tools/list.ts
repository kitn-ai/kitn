import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerListTool(server: McpServer) {
  registerTool<{ cwd: string; type?: string }>(
    server,
    "kitn_list",
    {
      description:
        "List available and installed components from configured registries",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        type: z
          .string()
          .optional()
          .describe(
            "Filter by component type (agent, tool, skill, storage, package, cron)",
          ),
      },
    },
    async ({ cwd, type }) => {
      try {
        const result = await listComponents({ cwd, type });
        // Convert Map to plain object for JSON serialization
        const serializable = {
          items: result.items,
          groups: Object.fromEntries(result.groups),
          stats: result.stats,
          errors: result.errors,
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(serializable, null, 2) },
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
