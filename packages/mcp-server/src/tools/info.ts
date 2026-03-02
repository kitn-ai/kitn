import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getComponentInfo } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerInfoTool(server: McpServer) {
  registerTool<{ component: string; cwd: string }>(
    server,
    "kitn_info",
    {
      description:
        "Get full details about a component — docs, files, dependencies, changelog",
      inputSchema: {
        component: z
          .string()
          .describe("Component name (e.g. 'weather-agent')"),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ component, cwd }) => {
      try {
        const result = await getComponentInfo({ component, cwd });
        const { item, indexItem, namespace, installed, installedVersion, updateAvailable } = result;
        const summary = {
          name: item.name,
          type: indexItem.type,
          description: item.description,
          version: item.version ?? indexItem.version,
          namespace,
          dependencies: item.dependencies ?? [],
          registryDependencies: item.registryDependencies ?? [],
          docs: item.docs,
          installed,
          ...(installed ? { installedVersion, updateAvailable } : {}),
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
