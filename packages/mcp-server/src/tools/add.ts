import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerAddTool(server: McpServer) {
  registerTool<{ components: string[]; cwd: string }>(
    server,
    "kitn_add",
    {
      description:
        "Install component(s) from the kitn registry with automatic dependency resolution",
      inputSchema: {
        components: z
          .array(z.string())
          .describe(
            "Component names to install (e.g. ['weather-agent', 'calculator'])",
          ),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ components, cwd }) => {
      try {
        const result = await addComponents({
          components,
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
