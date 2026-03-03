import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newProject, PROVIDERS, VALID_PROVIDERS } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerNewTool(server: McpServer) {
  registerTool<{
    name: string;
    path: string;
    framework?: string;
    runtime?: string;
    provider?: string;
    apiKey?: string;
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
        provider: z
          .string()
          .optional()
          .describe(
            `AI provider: ${VALID_PROVIDERS.join(", ")} (default: openrouter)`,
          ),
        apiKey: z
          .string()
          .optional()
          .describe("API key for the selected provider (written to .env)"),
      },
    },
    async ({ name, path, framework, runtime, provider, apiKey }) => {
      try {
        const result = await newProject({
          name,
          targetDir: path,
          framework,
          runtime,
          provider,
          apiKey,
        });

        const providerDef = PROVIDERS[provider ?? "openrouter"];
        const installCmd =
          result.runtime === "bun" ? "bun install" : "npm install";
        const runCmd = result.runtime === "bun" ? "bun dev" : "npm run dev";

        const nextSteps = [`cd ${name}`, installCmd];
        if (!apiKey) {
          nextSteps.push(`Edit .env  # add your ${providerDef.envVar}`);
        }
        nextSteps.push(runCmd);

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
                  provider: provider ?? "openrouter",
                  nextSteps,
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
