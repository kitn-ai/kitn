import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { unlinkToolInProject } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerUnlinkTool(server: McpServer) {
  registerTool<{ toolName: string; agentName: string; cwd: string }>(
    server,
    "kitn_unlink",
    {
      description:
        "Unlink a tool from an agent — removes the import and tool reference",
      inputSchema: {
        toolName: z
          .string()
          .describe("Tool name to unlink (e.g. 'calculator')"),
        agentName: z
          .string()
          .describe(
            "Agent name to unlink the tool from (e.g. 'general-agent')",
          ),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ toolName, agentName, cwd }) => {
      try {
        const result = await unlinkToolInProject({
          toolName,
          agentName,
          cwd,
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
