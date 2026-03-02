import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectContext } from "@kitnai/cli-core";

/**
 * Register the kitn://project resource.
 *
 * Provides the current kitn project configuration (kitn.json, installed
 * components, framework, runtime) for the working directory.
 */
export function registerProjectResource(server: McpServer) {
  (server as any).resource(
    "project",
    "kitn://project",
    { description: "Current kitn project configuration (kitn.json)" },
    async () => {
      const cwd = process.cwd();
      const context = await getProjectContext({ cwd });
      return {
        contents: [
          {
            uri: "kitn://project",
            text: JSON.stringify(context, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
