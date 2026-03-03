# kitn MCP Server

The kitn MCP server exposes 16 tools to any AI coding assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io/) — Claude Code, Cursor, VS Code Copilot, Windsurf, and others.

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

Once connected, the 16 `kitn_*` tools are available automatically. You don't need to be explicit — your AI assistant will use them when your request relates to kitn.

### Scaffolding a new project

> "Initialize kitn in this project"

### Adding components

> "Add the weather-agent component"
>
> "Install the calculator tool and its dependencies"

### Exploring the registry

> "What kitn components are available?"
>
> "Show me details about the web-search tool"
>
> "Search for agents related to scheduling"

### Managing components

> "Remove the weather-agent"
>
> "Update all installed components to the latest version"
>
> "Show me what's different between my local weather-agent and the registry version"

### Scaffolding custom code

> "Create a new agent called support-bot"
>
> "Create a tool called sentiment-analysis"

### Wiring things together

> "Link the web-search tool to my general agent"
>
> "Unlink calculator from the support-bot agent"

### Project context

> "What kitn components do I have installed?"
>
> "Regenerate my AI rules files"

You can also be explicit if you want — "use kitn_add to install weather-agent" — but it's not required.

## Available Tools

| Tool | Description |
|------|-------------|
| `kitn_init` | Initialize kitn in a project |
| `kitn_add` | Install component(s) with dependency resolution |
| `kitn_remove` | Remove an installed component |
| `kitn_update` | Update to latest registry version |
| `kitn_create` | Scaffold a new agent, tool, skill, storage, or cron |
| `kitn_link` | Wire a tool into an agent |
| `kitn_unlink` | Remove a tool from an agent |
| `kitn_list` | List available and installed components |
| `kitn_info` | Full component details and docs |
| `kitn_diff` | Local vs registry diff |
| `kitn_project` | Get project context (config, installed components) |
| `kitn_rules` | Regenerate AI coding rules files |
| `kitn_registry_search` | Search configured registries |
| `kitn_registry_list` | Show configured registries |
| `kitn_registry_add` | Add a custom registry |
| `kitn_help` | Get kitn coding guidance on a topic |
