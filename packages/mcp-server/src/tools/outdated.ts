import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { outdatedComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerOutdatedTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_outdated",
    {
      description:
        "Show installed components with newer versions available in the registry",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await outdatedComponents({ cwd });
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
