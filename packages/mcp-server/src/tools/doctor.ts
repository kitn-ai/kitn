import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { doctorCheck } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerDoctorTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_doctor",
    {
      description:
        "Check project integrity — files, hashes, dependencies, orphans",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await doctorCheck({ cwd });
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
