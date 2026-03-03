import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchRulesTemplate, DEFAULT_REGISTRIES } from "@kitnai/cli-core";

/**
 * Register the kitn://rules resource.
 *
 * Provides the full kitn coding conventions and patterns template
 * that AI coding assistants can reference.
 */
export function registerRulesResource(server: McpServer) {
  (server as any).resource(
    "rules",
    "kitn://rules",
    { description: "kitn coding conventions and patterns — comprehensive guide for AI coding assistants" },
    async () => {
      const template = await fetchRulesTemplate(DEFAULT_REGISTRIES);
      return {
        contents: [
          {
            uri: "kitn://rules",
            text: template,
            mimeType: "text/markdown",
          },
        ],
      };
    },
  );
}
