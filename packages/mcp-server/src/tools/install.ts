import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { installFromLock } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerInstallTool(server: McpServer) {
  registerTool<{ cwd: string; frozen?: boolean }>(
    server,
    "kitn_install",
    {
      description:
        "Install components from kitn.lock at their exact recorded versions (like npm ci)",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        frozen: z
          .boolean()
          .optional()
          .describe("Fail if lock file is inconsistent or local files differ (CI mode)"),
      },
    },
    async ({ cwd, frozen }) => {
      try {
        const result = await installFromLock({ cwd, frozen });
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
