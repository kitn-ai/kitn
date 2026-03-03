import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initProject, addComponents, resolveRoutesAlias } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerInitTool(server: McpServer) {
  registerTool<{
    cwd: string;
    runtime: string;
    framework: string;
    baseDir?: string;
  }>(
    server,
    "kitn_init",
    {
      description:
        "Initialize kitn in a project — creates kitn.json, patches tsconfig, scaffolds plugin",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        runtime: z
          .string()
          .describe("Runtime to use (bun, node, deno)"),
        framework: z
          .string()
          .describe("HTTP framework (hono, hono-openapi, elysia)"),
        baseDir: z
          .string()
          .optional()
          .describe("Base directory for components (default: src/ai)"),
      },
    },
    async ({ cwd, runtime, framework, baseDir }) => {
      try {
        const result = await initProject({ cwd, runtime, framework, baseDir });

        // Install core engine + framework adapter (same as CLI initCommand)
        const routesAdapter = resolveRoutesAlias(result.config);
        const addResult = await addComponents({
          components: ["core", routesAdapter],
          cwd,
          overwrite: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify({
            configPath: result.configPath,
            runtime: result.config.runtime,
            framework: result.config.framework ?? framework,
            baseDir: result.config.aliases.base ?? baseDir ?? "src/ai",
            installed: addResult.resolved.map((i) => ({ name: i.name, type: i.type })),
            npmDeps: addResult.npmDeps,
          }, null, 2) }],
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
