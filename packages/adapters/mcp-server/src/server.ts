import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PluginContext } from "@kitnai/core";
import { executeTask } from "@kitnai/core";
import type { MCPServerConfig } from "./types.js";
import { toolResultToMCP, toolErrorToMCP } from "./bridge.js";

export function createMCPServer(ctx: PluginContext, config: MCPServerConfig) {
  const server = new McpServer({
    name: config.name,
    version: config.version ?? "1.0.0",
  });

  // Register tools
  const allTools = ctx.tools.list();
  const tools = config.tools
    ? allTools.filter((t) => config.tools!.includes(t.name))
    : allTools;

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      },
      async (input: any) => {
        try {
          const result = await ctx.tools.execute(tool.name, input);
          return toolResultToMCP(result);
        } catch (error) {
          return toolErrorToMCP(error);
        }
      },
    );
  }

  // Register agents as MCP tools
  if (config.agents) {
    for (const agentName of config.agents) {
      const agent = ctx.agents.get(agentName);
      if (!agent) continue;

      server.registerTool(
        `agent_${agentName}`,
        {
          description: agent.description || `Chat with the ${agentName} agent`,
          inputSchema: z.object({
            message: z.string().describe("Message to send to the agent"),
          }),
        },
        async ({ message }: { message: string }) => {
          try {
            const result = await executeTask(ctx, agentName, message);
            return toolResultToMCP(result.result.response);
          } catch (error) {
            return toolErrorToMCP(error);
          }
        },
      );
    }
  }

  return {
    server,
    async connectStdio() {
      const { StdioServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/stdio.js"
      );
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
