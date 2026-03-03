# kitn MCP Server

The kitn MCP server exposes 25 tools and 2 resources to any AI coding assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io/) — Claude Code, Cursor, VS Code Copilot, Windsurf, Zed, and others.

> **Using kitn in your own project?** Install via npm — see the [MCP server README](packages/mcp-server/README.md) for setup instructions for all editors.
>
> This page covers **local development** — running the MCP server from source for monorepo contributors.

## Connect to the hosted server

The kitn MCP server is available at `https://mcp.kitn.dev/mcp`.

### Claude Code

```bash
claude mcp add --transport http kitn https://mcp.kitn.dev/mcp
```

### Cursor

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "kitn": {
      "url": "https://mcp.kitn.dev/mcp"
    }
  }
}
```

### VS Code Copilot

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "kitn": {
      "type": "http",
      "url": "https://mcp.kitn.dev/mcp"
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "kitn": {
      "serverUrl": "https://mcp.kitn.dev/mcp"
    }
  }
}
```

## Local development

If you're working on the kitn monorepo itself and want the MCP server to reflect your local changes in real time, run it from source instead.

`dev:mcp` uses `bun --watch` to run the TypeScript source directly — no build step needed. Any change to `packages/mcp-server/` or `packages/cli-core/` auto-restarts the server, and your editor reconnects automatically.

### Claude Code

```bash
# Replace with the absolute path to your local kitn monorepo clone
claude mcp add --transport stdio kitn -- bun run --cwd /absolute/path/to/kitn-monorepo dev:mcp

# Example: if you cloned to ~/Projects/kitn
claude mcp add --transport stdio kitn -- bun run --cwd ~/Projects/kitn dev:mcp
```

### Cursor

```json
{
  "mcpServers": {
    "kitn": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/kitn-monorepo", "dev:mcp"]
    }
  }
}
```

### VS Code Copilot

```json
{
  "servers": {
    "kitn": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/kitn-monorepo", "dev:mcp"]
    }
  }
}
```

### Windsurf

```json
{
  "mcpServers": {
    "kitn": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/kitn-monorepo", "dev:mcp"]
    }
  }
}
```

### HTTP mode (local)

Run the MCP server over HTTP locally for testing with web clients:

```bash
bun run mcp:http              # Starts on http://localhost:8080/mcp
PORT=3000 bun run mcp:http    # Custom port
```

### Inspect

Browse tools and test them in a web UI with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
bun run mcp:inspect
```

## Usage

Once connected, all `kitn_*` tools are available automatically. You don't need to be explicit — your AI assistant will use them when your request relates to kitn.

For usage examples and the full tool reference, see the [MCP server README](packages/mcp-server/README.md#usage).
