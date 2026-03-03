import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchRulesTemplate,
  parseRulesSections,
  findRelevantSections,
  DEFAULT_REGISTRIES,
  readConfig,
} from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerHelpTool(server: McpServer) {
  registerTool<{ topic: string; cwd?: string }>(
    server,
    "kitn_help",
    {
      description:
        "Get kitn coding guidance on a specific topic (e.g. 'defining tools', 'agents', 'storage', 'voice')",
      inputSchema: {
        topic: z
          .string()
          .describe(
            "Topic to get help on (e.g. 'tool', 'agent', 'orchestrator', 'storage', 'voice', 'cron', 'guard', 'memory', 'mcp', 'import')",
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Project working directory (uses default registries if omitted)",
          ),
      },
    },
    async ({ topic, cwd }) => {
      try {
        // Use project registries if cwd is provided, otherwise defaults
        let registries = DEFAULT_REGISTRIES;
        if (cwd) {
          const config = await readConfig(cwd);
          if (config) {
            registries = config.registries;
          }
        }

        const template = await fetchRulesTemplate(registries);
        const sections = parseRulesSections(template);
        const relevant = findRelevantSections(sections, topic);

        if (relevant.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No guidance found for topic "${topic}". Try one of: tool, agent, orchestrator, storage, voice, cron, guard, memory, mcp, import, cli, hooks, jobs`,
              },
            ],
          };
        }

        const content = relevant
          .map((s) => s.content)
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text", text: content }],
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
