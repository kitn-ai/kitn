import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { whyComponent } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerWhyTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_why",
    {
      description:
        "Explain why a component is installed by tracing its reverse dependency chain",
      inputSchema: {
        component: z.string().describe("Component name to look up"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await whyComponent({ component, cwd });
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
