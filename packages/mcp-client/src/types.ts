import type { createMCPClient } from "@ai-sdk/mcp";

/** Configuration for a single MCP server connection. */
export interface ServerConfig {
  /** Unique name for this server (used as tool namespace prefix). */
  name: string;

  /** Transport configuration. */
  transport:
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> }
    | { type: "stdio"; command: string; args?: string[] };
}

/** Configuration for connectMCPServers(). */
export interface MCPClientConfig {
  /** List of MCP servers to connect to. */
  servers: ServerConfig[];
}

/** Return value from connectMCPServers(). */
export interface MCPConnection {
  /** Connected MCP clients, keyed by server name. */
  clients: Map<string, Awaited<ReturnType<typeof createMCPClient>>>;

  /** Re-discover and re-register tools from one or all servers. */
  refresh: (serverName?: string) => Promise<void>;

  /** Disconnect all MCP clients. Call on shutdown. */
  close: () => Promise<void>;
}
