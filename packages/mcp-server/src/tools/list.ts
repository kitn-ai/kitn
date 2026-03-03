import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listComponents } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerListTypesTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_list_types",
    {
      description:
        "Get available component type categories and counts. Call this first to discover what types exist, then use kitn_list with a specific type.",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await listComponents({ cwd });
        const types = Array.from(result.groups.entries()).map(([type, items]) => ({
          type,
          total: items.length,
          installed: items.filter((i) => i.installed).length,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ types, stats: result.stats }, null, 2) }],
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

export function registerListTool(server: McpServer) {
  registerTool<{ cwd: string; type: string }>(
    server,
    "kitn_list",
    {
      description:
        "List components of a specific type. Use kitn_list_types first to see available types.",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        type: z
          .string()
          .describe("Component type to list (agent, tool, skill, storage, package, cron)"),
      },
    },
    async ({ cwd, type }) => {
      try {
        const result = await listComponents({ cwd, type });
        const serializable = {
          items: result.items.map((item) => ({
            name: item.name,
            type: item.type,
            description: item.description,
            installed: item.installed,
            ...(item.updateAvailable ? { updateAvailable: true, version: item.version } : {}),
          })),
          stats: result.stats,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(serializable, null, 2) }],
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
