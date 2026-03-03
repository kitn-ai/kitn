# @kitnai/mcp-server

MCP server for [kitn](https://github.com/kitn-ai/kitn) — manage AI agent projects from any editor that supports the [Model Context Protocol](https://modelcontextprotocol.io/).

Install components, scaffold agents and tools, wire dependencies, and explore the registry — all through your AI coding assistant.

## Install

### Claude Code

```bash
claude mcp add kitn -- npx -y @kitnai/mcp-server
```

### Cursor

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "kitn": {
      "command": "npx",
      "args": ["-y", "@kitnai/mcp-server"]
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
      "command": "npx",
      "args": ["-y", "@kitnai/mcp-server"]
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
      "command": "npx",
      "args": ["-y", "@kitnai/mcp-server"]
    }
  }
}
```

### Zed

Add to Zed settings (`cmd+,` > MCP Servers):

```json
{
  "context_servers": {
    "kitn": {
      "command": {
        "path": "npx",
        "args": ["-y", "@kitnai/mcp-server"]
      }
    }
  }
}
```

### Any MCP-compatible client

The server uses **stdio** transport. Run the binary and communicate over stdin/stdout:

```bash
npx -y @kitnai/mcp-server
```

You can also install globally:

```bash
npm install -g @kitnai/mcp-server
kitn-mcp
```

## Usage

Once connected, the MCP tools are available automatically. Your AI assistant will use them when your request relates to kitn — no need to be explicit.

### Scaffolding a new project

> "Create a new kitn project called my-api"
>
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
> "Show me the dependency tree"
>
> "Regenerate my AI rules files"

### Testing tools and agents

> "Try the weather tool with city Tokyo"
>
> "Send 'What is 2+2?' to the general agent"

## Tools

25 tools across 6 categories:

### Project setup

| Tool | Description |
|------|-------------|
| `kitn_project` | Get project context — config, installed components, framework, runtime |
| `kitn_init` | Initialize kitn in a project |
| `kitn_new` | Create a new project from a starter template |
| `kitn_rules` | Generate or regenerate AI coding rules files |

### Component management

| Tool | Description |
|------|-------------|
| `kitn_add` | Install component(s) with automatic dependency resolution |
| `kitn_remove` | Remove an installed component |
| `kitn_update` | Update installed components to the latest registry version |
| `kitn_create` | Scaffold a new agent, tool, skill, storage, or cron |
| `kitn_link` | Wire a tool into an agent's tools object |
| `kitn_unlink` | Remove a tool from an agent |

### Discovery

| Tool | Description |
|------|-------------|
| `kitn_list_types` | Get available component type categories and counts |
| `kitn_list` | List components of a specific type |
| `kitn_info` | Full component details — docs, files, dependencies, changelog |
| `kitn_diff` | Show differences between local and registry version |

### Package management

| Tool | Description |
|------|-------------|
| `kitn_install` | Install components from kitn.lock at exact recorded versions |
| `kitn_outdated` | Show installed components with newer versions available |
| `kitn_why` | Explain why a component is installed (reverse dependency chain) |
| `kitn_tree` | Show the dependency tree of installed components |
| `kitn_doctor` | Check project integrity — files, hashes, dependencies, orphans |

### Registry

| Tool | Description |
|------|-------------|
| `kitn_registry_search` | Search configured registries by name or description |
| `kitn_registry_list` | List all configured registries |
| `kitn_registry_add` | Add a third-party registry |

### Testing

| Tool | Description |
|------|-------------|
| `kitn_try_tool` | Execute a kitn tool with input parameters and return the result |
| `kitn_try_agent` | Send a prompt to a kitn agent and return the response |
| `kitn_help` | Get kitn coding guidance on a specific topic |

## Resources

| Resource | Description |
|----------|-------------|
| `kitn://project` | Current project configuration and installed components |
| `kitn://rules` | Full kitn coding conventions and patterns template |

## Local development

If you're working on the kitn monorepo itself and want the MCP server to reflect local changes in real time, run from source instead of npm. See [MCP.md](../../MCP.md) in the repo root for editor-specific setup instructions.

## Related packages

- [`@kitnai/cli`](../cli/README.md) — Interactive CLI for the component registry
- [`@kitnai/cli-core`](../cli-core/) — Pure logic shared by CLI and MCP server

## License

MIT
