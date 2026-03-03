import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { componentTree, renderTree } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerTreeTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_tree",
    {
      description:
        "Show the dependency tree of installed components with type annotations",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await componentTree({ cwd });
        const text = renderTree(result.roots);
        return {
          content: [
            {
              type: "text",
              text: text || "(no components installed)",
            },
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
