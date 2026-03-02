import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createComponent } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerCreateTool(server: McpServer) {
  registerTool<{ type: string; name: string; cwd: string }>(
    server,
    "kitn_create",
    {
      description:
        "Create a new component from a template (agent, tool, skill, storage, cron)",
      inputSchema: {
        type: z
          .string()
          .describe("Component type: agent, tool, skill, storage, cron"),
        name: z
          .string()
          .describe("Component name (e.g. 'my-agent', 'search-tool')"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ type, name, cwd }) => {
      try {
        const result = await createComponent({
          type,
          name,
          cwd,
          overwrite: true,
        });
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
