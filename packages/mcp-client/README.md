# @kitnai/mcp-client

MCP client for [kitn](https://github.com/kitn-ai/kitn) -- consume external [MCP servers](https://modelcontextprotocol.io/) as tool sources.

Connects to one or more MCP servers, discovers their tools, and registers them into kitn's `ToolRegistry` with automatic namespacing. Your agents can then call tools from GitHub, Slack, databases, or any other MCP-compatible service alongside native kitn tools.

## Installation

```bash
bun add @kitnai/mcp-client
```

### Peer dependencies

```bash
bun add @ai-sdk/mcp zod
```

`@kitnai/core` is also required (included as a direct dependency).

## How it works

1. You provide a list of MCP server configs (name + transport).
2. `connectMCPServers` connects to each server via `@ai-sdk/mcp` and calls `client.tools()` to discover available tools.
3. Each discovered tool is registered into kitn's `PluginContext.tools` registry, namespaced by server name (e.g. a tool called `createIssue` on a server named `github` becomes `github_createIssue`).
4. Agents configured with those tools can now invoke them like any other kitn tool.

## Exports

| Export | Description |
|---|---|
| `connectMCPServers` | Connect to MCP servers and register their tools into a `PluginContext`. Returns an `MCPConnection` with `refresh()` and `close()` methods. |
| `namespaceTool` | Create a namespaced tool name from server name and tool name (e.g. `"github"` + `"createIssue"` -> `"github_createIssue"`). |
| `buildToolRegistration` | Build a kitn `ToolRegistration` from an MCP tool, applying namespace and description prefix. |
| `MCPClientConfig` | Configuration type for `connectMCPServers`. Contains a `servers` array. |
| `ServerConfig` | Configuration for a single MCP server: `name` and `transport` (http, sse, or stdio). |
| `MCPConnection` | Return type from `connectMCPServers`. Provides `clients`, `refresh()`, and `close()`. |

## Usage

### Connect to MCP servers

```ts
import { connectMCPServers } from "@kitn/mcp-client";
import type { PluginContext } from "@kitn/core";

const connection = await connectMCPServers(ctx, {
  servers: [
    {
      name: "github",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
    },
    {
      name: "filesystem",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    },
  ],
});

// Tools are now registered in ctx.tools as:
//   github_createIssue, github_listRepos, ...
//   filesystem_readFile, filesystem_writeFile, ...
```

### Transport types

Three transport types are supported:

```ts
// HTTP (Streamable HTTP)
{ type: "http", url: "https://mcp.example.com", headers: { "Authorization": "Bearer ..." } }

// SSE (Server-Sent Events)
{ type: "sse", url: "https://mcp.example.com/sse", headers: { "Authorization": "Bearer ..." } }

// Stdio (spawns a subprocess)
{ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }
```

### Refresh tools

Re-discover tools from one or all connected servers (useful if the server's tool set changes at runtime):

```ts
// Refresh all servers
await connection.refresh();

// Refresh a specific server
await connection.refresh("github");
```

### Clean up

Disconnect all MCP clients on shutdown:

```ts
await connection.close();
```

## Tests

```bash
bun test packages/mcp-client
```

## Monorepo

This package is part of the [kitn monorepo](../../README.md).
