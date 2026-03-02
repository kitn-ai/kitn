import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchAllIndexItems,
  listRegistries,
  addRegistry,
  readConfig,
  DEFAULT_REGISTRIES,
} from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerRegistrySearchTool(server: McpServer) {
  registerTool<{ query: string; type?: string; cwd: string }>(
    server,
    "kitn_registry_search",
    {
      description:
        "Search configured registries for components by name or description",
      inputSchema: {
        query: z
          .string()
          .describe("Search query (searches name and description)"),
        type: z
          .string()
          .optional()
          .describe(
            "Filter by type (agent, tool, skill, storage, package, cron)",
          ),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ query, type, cwd }) => {
      try {
        const config = await readConfig(cwd);
        const registries = config?.registries ?? DEFAULT_REGISTRIES;

        const allItems = await fetchAllIndexItems(registries);

        const lowerQuery = query.toLowerCase();
        const typeFilter = type ? `kitn:${type}` : undefined;

        const matches = allItems.filter((item) => {
          if (typeFilter && item.type !== typeFilter) return false;
          const nameMatch = item.name.toLowerCase().includes(lowerQuery);
          const descMatch = item.description
            .toLowerCase()
            .includes(lowerQuery);
          return nameMatch || descMatch;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query,
                type: type ?? "all",
                results: matches.map((item) => ({
                  name: item.name,
                  type: item.type,
                  description: item.description,
                })),
              }, null, 2),
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

export function registerRegistryListTool(server: McpServer) {
  registerTool<{ cwd: string }>(
    server,
    "kitn_registry_list",
    {
      description: "List all configured registries in the project",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ cwd }) => {
      try {
        const result = await listRegistries({ cwd });
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

export function registerRegistryAddTool(server: McpServer) {
  registerTool<{
    namespace: string;
    url: string;
    cwd: string;
    homepage?: string;
    description?: string;
  }>(
    server,
    "kitn_registry_add",
    {
      description: "Add a third-party registry to the project configuration",
      inputSchema: {
        namespace: z
          .string()
          .describe("Registry namespace (e.g. '@myteam')"),
        url: z
          .string()
          .describe(
            "Registry URL template with {type} and {name} placeholders",
          ),
        cwd: z.string().describe("Project working directory"),
        homepage: z.string().optional().describe("Registry homepage URL"),
        description: z
          .string()
          .optional()
          .describe("Short description of the registry"),
      },
    },
    async ({ namespace, url, cwd, homepage, description }) => {
      try {
        await addRegistry({
          namespace,
          url,
          cwd,
          overwrite: true,
          homepage,
          description,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Registry '${namespace}' added successfully`,
                },
                null,
                2,
              ),
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
