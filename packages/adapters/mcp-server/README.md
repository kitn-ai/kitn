# @kitnai/mcp-server-adapter

MCP server adapter for kitn. Expose your kitn tools and agents as an [MCP](https://modelcontextprotocol.io/) server so any MCP-compatible client (Claude Code, Cursor, Copilot, Windsurf, Zed, etc.) can call them directly.

> **Not to be confused with `@kitnai/mcp-server`**, which is the kitn CLI's own MCP server for managing kitn projects. This adapter is for exposing _your_ application's tools and agents via MCP.

## Installation

```bash
bun add @kitnai/mcp-server-adapter
```

Peer dependencies:

```bash
bun add @modelcontextprotocol/sdk zod
```

## Quick Start

`createMCPServer` takes a kitn `PluginContext` (returned by `createAIPlugin` from any kitn adapter) and an `MCPServerConfig`, then returns an MCP server ready to connect.

```ts
import { createAIPlugin, createFileStorage } from "@kitn/routes";
import { createMCPServer } from "@kitn/adapters/mcp-server";
import { tool } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

// 1. Set up your kitn plugin as usual
const plugin = createAIPlugin({
  model: (model) => openai(model ?? "gpt-4o-mini"),
  storage: createFileStorage({ dataDir: "./data" }),
});

// 2. Register tools and agents
const getWeather = tool({
  description: "Get weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ temp: 72, city }),
});

plugin.tools.register({
  name: "getWeather",
  description: "Get weather for a city",
  inputSchema: z.object({ city: z.string() }),
  tool: getWeather,
});

// 3. Create the MCP server
const mcp = createMCPServer(plugin, {
  name: "my-app",
  version: "1.0.0",
  // Optional: filter which tools to expose (exposes all by default)
  tools: ["getWeather"],
  // Optional: expose agents as MCP tools
  agents: ["weather"],
});

// 4. Connect via stdio transport
await mcp.connectStdio();
```

## How It Works

- **Tools** registered on your kitn plugin are converted to MCP tools. When an MCP client calls a tool, the adapter executes it via the kitn tool registry and converts the result to the MCP response format.

- **Agents** listed in the config are exposed as MCP tools named `agent_<name>`. Each accepts a `{ message: string }` input. When called, the adapter runs the agent via `executeTask` and returns the response.

- **Tool filtering**: By default all registered tools are exposed. Pass a `tools` array to limit which tools are available to MCP clients. Agents are opt-in -- only those listed in the `agents` array are exposed.

## Configuration

`createMCPServer(ctx, config)` accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | **required** | Server name reported to MCP clients. |
| `version` | `string` | `"1.0.0"` | Server version reported to MCP clients. |
| `tools` | `string[]` | all tools | Whitelist of tool names to expose. Omit to expose all registered tools. |
| `agents` | `string[]` | none | Agent names to expose as MCP tools. Each is registered as `agent_<name>`. |

## Exports

| Export | Description |
|---|---|
| `createMCPServer(ctx, config)` | Creates an MCP server from a kitn `PluginContext`. Returns `{ server, connectStdio() }`. |
| `MCPServerConfig` | TypeScript interface for the config object. |
| `toolResultToMCP(result)` | Converts a tool execution result to MCP `CallToolResult` format. |
| `toolErrorToMCP(error)` | Converts an error to MCP error `CallToolResult` format with `isError: true`. |

## Return Value

`createMCPServer` returns an object with:

- **`server`** -- The underlying `McpServer` instance from `@modelcontextprotocol/sdk`. Use this if you need to register additional MCP resources, prompts, or custom transports.
- **`connectStdio()`** -- Convenience method that creates a `StdioServerTransport` and connects the server. This is the standard way to run an MCP server as a subprocess.

## Monorepo

This package is part of the [kitn monorepo](../../README.md). See the root README for workspace setup and the full list of packages.
