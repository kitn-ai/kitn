import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { linkToolInProject } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerLinkTool(server: McpServer) {
  registerTool<{
    toolName: string;
    agentName: string;
    cwd: string;
    alias?: string;
  }>(
    server,
    "kitn_link",
    {
      description:
        "Link a tool to an agent — adds the import and wires it into the agent's tools object",
      inputSchema: {
        toolName: z
          .string()
          .describe("Tool name to link (e.g. 'calculator')"),
        agentName: z
          .string()
          .describe(
            "Agent name to link the tool to (e.g. 'general-agent')",
          ),
        cwd: z.string().describe("Project working directory"),
        alias: z
          .string()
          .optional()
          .describe(
            "Optional alias for the tool key in the agent's tools object",
          ),
      },
    },
    async ({ toolName, agentName, cwd, alias }) => {
      try {
        const result = await linkToolInProject({
          toolName,
          agentName,
          cwd,
          alias,
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
