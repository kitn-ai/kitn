import { createMCPClient } from "@ai-sdk/mcp";
import type { PluginContext } from "@kitnai/core";
import type { MCPClientConfig, MCPConnection, ServerConfig } from "./types.js";

/** Create a namespaced tool name: "serverName_toolName". */
export function namespaceTool(serverName: string, toolName: string): string {
  return `${serverName}_${toolName}`;
}

/** Build a kitn ToolRegistration from an MCP tool. */
export function buildToolRegistration(
  serverName: string,
  toolName: string,
  mcpTool: any,
) {
  return {
    name: namespaceTool(serverName, toolName),
    description: `[${serverName}] ${mcpTool.description ?? toolName}`,
    inputSchema: mcpTool.parameters,
    tool: mcpTool,
  };
}

/** Resolve transport config into something @ai-sdk/mcp understands. */
async function resolveTransport(transport: ServerConfig["transport"]) {
  // HTTP and SSE configs are passed through as-is (natively supported)
  if (transport.type === "http" || transport.type === "sse") {
    return transport;
  }
  // Stdio requires an actual transport instance
  const { Experimental_StdioMCPTransport } = await import("@ai-sdk/mcp/mcp-stdio");
  return new Experimental_StdioMCPTransport({
    command: transport.command,
    args: transport.args,
  });
}

/** Connect to one MCP server and register its tools. */
async function connectServer(
  ctx: PluginContext,
  config: ServerConfig,
) {
  const transport = await resolveTransport(config.transport);
  const client = await createMCPClient({ transport: transport as any });
  const tools = await client.tools();

  for (const [toolName, tool] of Object.entries(tools)) {
    ctx.tools.register(buildToolRegistration(config.name, toolName, tool));
  }

  return client;
}

/**
 * Connect to external MCP servers and register their tools into kitn's ToolRegistry.
 * Tools are namespaced by server name (e.g. "github_createIssue").
 */
export async function connectMCPServers(
  ctx: PluginContext,
  config: MCPClientConfig,
): Promise<MCPConnection> {
  const clients = new Map<string, Awaited<ReturnType<typeof createMCPClient>>>();

  for (const server of config.servers) {
    const client = await connectServer(ctx, server);
    clients.set(server.name, client);
  }

  return {
    clients,

    async refresh(serverName?: string) {
      const targets = serverName
        ? config.servers.filter((s) => s.name === serverName)
        : config.servers;

      for (const server of targets) {
        const client = clients.get(server.name);
        if (!client) continue;

        const tools = await client.tools();
        for (const [toolName, tool] of Object.entries(tools)) {
          ctx.tools.register(buildToolRegistration(server.name, toolName, tool));
        }
      }
    },

    async close() {
      await Promise.all(
        Array.from(clients.values()).map((c) => c.close()),
      );
      clients.clear();
    },
  };
}
