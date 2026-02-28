# MCP Support Design

**Goal:** Enable kitn projects to expose tools/agents as an MCP server and consume external MCP servers as tool sources — both as registry components (user-owned source code).

**Philosophy:** kitn's distribution model is source ownership (shadcn-ui style). The bridge code belongs to the developer. The protocol SDKs (`@modelcontextprotocol/sdk`, `@ai-sdk/mcp`) are npm dependencies that handle the heavy lifting.

---

## Architecture Overview

Two independent registry components:

```
kitn add mcp-server    # Expose kitn tools/agents to MCP clients
kitn add mcp-client    # Consume external MCP servers as tool sources
```

**Source development locations:**

| Component | Source | Registry type | npm dependency |
|-----------|--------|---------------|----------------|
| MCP Server | `packages/adapters/mcp-server/` | `kitn:package` | `@modelcontextprotocol/sdk` |
| MCP Client | `packages/mcp-client/` | `kitn:package` | `@ai-sdk/mcp` |

The server is an adapter (it creates a transport layer). The client is a utility (it enriches the tool registry). They live in different locations to reflect this distinction.

**Independence:** Users can install one without the other. A project might only expose tools (server), only consume external tools (client), or both.

---

## MCP Server

### Entry Point

`createMCPServer(plugin, config)` takes a kitn `AIPluginInstance` and returns an MCP `McpServer` ready to connect to a transport.

```ts
import { createMCPServer } from "./mcp-server";

const mcpServer = createMCPServer(plugin, {
  name: "my-service",
  version: "1.0.0",
});

// Developer chooses their transport:
// Stdio (for local tools — Claude Desktop, Cursor, etc.)
mcpServer.connectStdio();

// Or Streamable HTTP (for remote — other AI apps)
mcpServer.connectHTTP(req, res);
```

### What Gets Exposed

**Tools -> MCP Tools (automatic).** Every tool in `plugin.tools.list()` becomes an MCP tool:

- Uses existing `name`, `description`, `inputSchema` (Zod) directly — MCP SDK accepts Zod
- Calls `directExecute()` (or falls back to `tool.execute()`)
- Wraps the result as `{ content: [{ type: "text", text: JSON.stringify(result) }] }`
- Maps execution errors to `{ isError: true, content: [...] }`

**Agents -> MCP Tools (opt-in).** Agents the developer chooses to expose become MCP tools with a `message` string parameter. The bridge sends the message to the agent and returns the response. This gives full agent execution (tools, memory, conversation) — not just a message template.

**Filtering.** The developer controls what gets exposed:

```ts
createMCPServer(plugin, {
  name: "my-service",
  version: "1.0.0",
  tools: ["getWeather", "searchWeb"],     // Only these tools (default: all)
  agents: ["general"],                     // Expose these agents as MCP tools
});
```

### Developer Responsibilities (Not Ours)

- Transport choice and wiring
- Auth middleware (HTTP headers, etc.)
- Rate limiting
- Which port/process to run on

### Files (~200 lines total)

```
mcp-server.ts    # createMCPServer() — main entry, tool/agent registration
bridge.ts        # kitn tool result -> MCP content format conversion
types.ts         # MCPServerConfig
```

---

## MCP Client

### Entry Point

`connectMCPServers(plugin, config)` takes a kitn `AIPluginInstance` and a list of MCP server configs. Connects to each, discovers their tools, and registers them into `plugin.tools`.

```ts
import { connectMCPServers } from "./mcp-client";

const mcp = await connectMCPServers(plugin, {
  servers: [
    {
      name: "github",
      transport: { type: "http", url: "https://api.github.com/mcp" },
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` },
    },
    {
      name: "database",
      transport: { type: "stdio", command: "node", args: ["db-mcp-server.js"] },
    },
  ],
});

// Later, when shutting down:
await mcp.close();
```

### How Tools Get Registered

1. For each server, calls `createMCPClient()` from `@ai-sdk/mcp`
2. Fetches tools via `client.tools()` — returns AI SDK tool objects (already the right format)
3. Registers each into `plugin.tools` with a **namespaced name**: `github:createIssue`, `database:query`
4. The namespace prevents collisions with native kitn tools and between MCP servers

### How Agents Use Them

Once registered, MCP tools are regular kitn tools. Agents reference them by namespaced name:

```ts
plugin.agents.register({
  name: "dev-assistant",
  toolNames: ["getWeather", "github:createIssue", "github:listPRs"],
  // Native kitn tools and MCP tools mixed freely
});
```

### Return Value

```ts
{
  clients: Map<string, MCPClient>,  // keyed by server name
  refresh: (serverName?: string) => Promise<void>,  // re-discover tools
  close: () => Promise<void>,       // disconnect all
}
```

- `refresh()` re-fetches the tool list from one or all servers and re-registers. Useful if an MCP server adds tools at runtime.
- `close()` disconnects all clients. Call on shutdown.

### Auth

Passed through to the transport config. HTTP gets `headers`, stdio gets environment variables. kitn doesn't manage credentials.

### No Caching Layer

Tool schemas are small and fetched once at connect time. `refresh()` covers the "tool list changed" case. If a user needs periodic refresh, they set up an interval themselves.

### Fragility

The `@ai-sdk/mcp` client handles reconnection for HTTP/SSE transports. For stdio, if the process dies, the tools become unavailable. Connection errors are surfaced clearly but we don't auto-restart processes — that's infrastructure.

### Files (~150 lines total)

```
mcp-client.ts    # connectMCPServers() — connect, discover, register
types.ts         # MCPClientConfig, ServerConfig
```

---

## Boundaries — What We Don't Build

| Concern | Stance | Rationale |
|---------|--------|-----------|
| Auth/permissions | Developer's responsibility | Same as kitn today |
| Rate limiting | Developer's responsibility | Infrastructure concern |
| Tool result caching | Not included | YAGNI — execution is the SDK's job |
| Tool discovery caching | Not included | Schemas are small, fetched once |
| Auto-reconnect (stdio) | Not included | `@ai-sdk/mcp` handles HTTP/SSE; stdio is infrastructure |
| MCP Resources | Not in v1 | Tools and agents cover primary use cases |
| MCP Sampling | Not in v1 | Server-initiated LLM calls — niche |
| Polling/refresh loops | Not included | Developer calls `refresh()` when needed |

**Total scope:** ~350 lines of user-owned bridge code across both components, plus two npm dependencies for protocol handling.
