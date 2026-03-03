import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newProject } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerNewTool(server: McpServer) {
  registerTool<{
    name: string;
    path: string;
    framework?: string;
    runtime?: string;
  }>(
    server,
    "kitn_new",
    {
      description:
        "Create a new kitn project from a starter template. Scaffolds project files, initializes kitn, and installs core + routes adapter.",
      inputSchema: {
        name: z.string().describe("Project name (e.g. 'my-api')"),
        path: z
          .string()
          .describe("Parent directory to create the project in"),
        framework: z
          .string()
          .optional()
          .describe("Template: hono (default)"),
        runtime: z
          .string()
          .optional()
          .describe("Runtime: bun (default), node, deno"),
      },
    },
    async ({ name, path, framework, runtime }) => {
      try {
        const result = await newProject({
          name,
          targetDir: path,
          framework,
          runtime,
        });

        const installCmd =
          result.runtime === "bun" ? "bun install" : "npm install";
        const runCmd = result.runtime === "bun" ? "bun dev" : "npm run dev";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  projectPath: result.projectPath,
                  framework: result.framework,
                  runtime: result.runtime,
                  filesCreated: result.filesCreated.length,
                  npmDeps: result.npmDeps,
                  nextSteps: [
                    `cd ${name}`,
                    installCmd,
                    "cp .env.example .env  # add OPENROUTER_API_KEY",
                    runCmd,
                  ],
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
