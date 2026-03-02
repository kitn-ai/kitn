import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";

/**
 * Type-safe wrapper for McpServer.registerTool that avoids TS2589
 * ("Type instantiation is excessively deep and possibly infinite").
 *
 * The MCP SDK's registerTool generic interacts with the Zod v3 compat
 * layer in zod@3.25 to produce deep type recursion. This wrapper casts
 * through `any` to avoid that, while keeping the call-site API clean.
 *
 * The runtime behavior is identical to calling server.registerTool directly.
 */
export function registerTool<T extends Record<string, unknown>>(
  server: McpServer,
  name: string,
  config: {
    description: string;
    inputSchema: Record<string, ZodType>;
  },
  handler: (args: T) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>,
): void {
  (server as any).registerTool(name, config, handler);
}
