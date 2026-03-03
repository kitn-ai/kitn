import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addComponents, readLock, readConfig, resolveRoutesAlias } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerAddTool(server: McpServer) {
  registerTool<{ components: string[]; cwd: string }>(
    server,
    "kitn_add",
    {
      description:
        "Install component(s) from the kitn registry with automatic dependency resolution",
      inputSchema: {
        components: z
          .array(z.string())
          .describe(
            "Component names to install (e.g. ['weather-agent', 'calculator'])",
          ),
        cwd: z.string().describe("Project working directory"),
      },
    },
    async ({ components, cwd }) => {
      try {
        const result = await addComponents({
          components,
          cwd,
          overwrite: true,
        });
        // Check if routes adapter is installed — agents/tools won't be reachable without it
        let routesWarning: string | undefined;
        const hasAgentOrTool = result.resolved.some(
          (i) => i.type === "kitn:agent" || i.type === "kitn:tool",
        );
        if (hasAgentOrTool) {
          const [config, lock] = await Promise.all([readConfig(cwd), readLock(cwd)]);
          if (config) {
            const routesAdapter = resolveRoutesAlias(config);
            if (!lock[routesAdapter]) {
              routesWarning = `Routes adapter "${routesAdapter}" is not installed. Run kitn_add with ["${routesAdapter}"] or agents/tools will not be accessible via HTTP.`;
            }
          }
        }

        const summary = {
          installed: result.resolved.map((item) => ({
            name: item.name,
            type: item.type,
            description: item.description,
            version: item.version,
            updatedAt: item.updatedAt,
          })),
          filesCreated: result.created.length,
          filesUpdated: result.updated.length,
          filesSkipped: result.skipped.length,
          npmDeps: result.npmDeps,
          npmDevDeps: result.npmDevDeps,
          envVars: result.envVars,
          errors: result.errors,
          barrelUpdated: result.barrelUpdated,
          docs: result.resolved.flatMap((item) => item.docs ? [item.docs] : []),
          ...(routesWarning ? { warning: routesWarning } : {}),
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
