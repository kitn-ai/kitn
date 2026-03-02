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
        const summary = {
          updated: result.resolved.map((item) => ({
            name: item.name,
            type: item.type,
            description: item.description,
            version: item.version,
          })),
          filesUpdated: result.updated.length,
          filesCreated: result.created.length,
          filesSkipped: result.skipped.length,
          npmDeps: result.npmDeps,
          npmDevDeps: result.npmDevDeps,
          errors: result.errors,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
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
