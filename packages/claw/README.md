# KitnClaw

A personal AI assistant for daily life and work. KitnClaw runs locally on your machine, connects to the AI provider of your choice, and is accessible through multiple channels -- terminal, web browser, HTTP API, WebSocket, and (in the future) messaging apps like Discord, Telegram, and WhatsApp.

Built on [@kitn/core](https://github.com/kitn-ai/kitn), KitnClaw combines a rich set of built-in tools (filesystem, shell, web, memory, self-extension) with layered safety controls so you stay in charge of what your assistant can do.

## Installation

```bash
# Clone the monorepo and install dependencies
git clone https://github.com/kitn-ai/kitn.git
cd kitn
bun install
```

### Option A: Run from source (recommended for development)

No build step needed -- run directly with Bun:

```bash
bun run --cwd packages/claw dev
```

### Option B: Install as a global command

Build and link to make `kitnclaw` and `kclaw` available globally:

```bash
bun run --cwd packages/claw build
cd packages/claw && bun link
```

After linking, you can run `kitnclaw` from anywhere.

### Setup

On first launch, KitnClaw automatically runs the setup wizard. You can also run it manually:

```bash
# If using Option A:
bun run --cwd packages/claw dev setup

# If using Option B:
kitnclaw setup
```

The wizard walks you through:
1. Choosing your AI provider (OpenRouter, OpenAI, Anthropic, Google, Ollama, or any OpenAI-compatible endpoint)
2. Entering your API key
3. Selecting a default model
4. Picking a safety profile (cautious, balanced, or autonomous)
5. Optionally granting access to specific directories

## Quick Start

```bash
# Launch KitnClaw (runs setup automatically on first launch)
kitnclaw
```

This starts the gateway, which:
- Opens the terminal TUI for interactive chat
- Starts the HTTP server with the web UI at `http://localhost:18800/`
- Begins the cron scheduler for proactive tasks

On first run with no config file, KitnClaw automatically launches the setup wizard before starting the gateway.

## Configuration

All configuration lives in a single JSON file at `~/.kitnclaw/kitnclaw.json`. The setup wizard creates this file for you, but you can also edit it directly.

### Key settings

```jsonc
{
  // AI provider
  "provider": {
    "type": "openrouter",  // openrouter | openai | anthropic | google | ollama | custom
    "apiKey": "sk-...",    // stored in OS keychain when possible
    "baseUrl": "..."       // only needed for custom/ollama
  },

  // Default model
  "model": "openai/gpt-4o-mini",

  // Channels
  "channels": {
    "terminal": { "enabled": true },
    "discord": { "token": "...", "enabled": true },
    "telegram": { "token": "...", "enabled": true }
  },

  // Permissions
  "permissions": {
    "profile": "balanced",           // cautious | balanced | autonomous
    "sandbox": "~/.kitnclaw/workspace",
    "grantedDirs": ["/home/user/Documents"],
    "denied": [],                    // globally denied tool names
    "rules": {},                     // per-tool firewall rules
    "rateLimits": {
      "maxPerMinute": 30,
      "toolLimits": { "bash": 10 }
    }
  },

  // Governance
  "governance": {
    "actions": {
      "send-message": "draft",      // auto | draft | blocked
      "post-public": "draft",
      "schedule": "draft"
    },
    "budgets": {
      "api-calls": { "limit": 50, "period": "monthly" }
    }
  },

  // Gateway (HTTP server)
  "gateway": {
    "port": 18800,
    "bind": "loopback",             // loopback | lan
    "authToken": "your-secret-token"
  },

  // Users
  "users": {
    "alice": { "role": "operator" },
    "bob": { "role": "user" },
    "guest-web": { "role": "guest", "channels": ["http"] }
  },

  // MCP servers (external tool providers)
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

## Safety Profiles

Safety profiles control how much KitnClaw asks before acting. Pick one during setup, or change it any time in the config file.

| Action | Cautious | Balanced (default) | Autonomous |
|---|---|---|---|
| Read files | Ask | Automatic | Automatic |
| Write to workspace | Ask | Automatic | Automatic |
| Write to granted dirs | Ask | Automatic | Automatic |
| Write elsewhere | Ask | Ask | Automatic |
| Web search | Ask | Automatic | Automatic |
| Web fetch | Ask | Automatic | Automatic |
| Memory | Automatic | Automatic | Automatic |
| Shell commands | Ask | Ask | Automatic |
| Delete files | Ask | Ask | Ask |
| Send messages | Ask | Ask | Ask |
| Install components | Ask | Ask | Automatic |
| Create tools/agents | Ask | Ask | Automatic |
| Unknown actions | Ask | Ask | Ask |

**Delete** and **send-message** always require confirmation, regardless of profile. These are hardcoded as ALWAYS_ASK actions.

## Channels

KitnClaw supports multiple channels for interacting with your assistant:

- **Terminal TUI** (default) -- Interactive terminal interface, enabled by default. Supports permission prompts inline.
- **Web UI** -- Built-in chat interface served at `http://localhost:18800/`. Dark-themed, mobile-friendly, shows tool call details. No separate build step required.
- **HTTP API** -- `POST /api/message` with `{ sessionId, text }`. Returns JSON with the assistant's response and tool calls. Auth via `Authorization: Bearer <token>` header.
- **WebSocket** -- Connect to `/ws` for real-time bidirectional communication. Auth via `?token=<token>` query parameter.
- **Discord / Telegram / WhatsApp** -- Planned via messaging channel adapters. Configure tokens in the `channels` section of your config.

## Remote Access

KitnClaw runs an HTTP server on port 18800 (configurable via `gateway.port`).

**Local only (default):** The server binds to `127.0.0.1` (loopback), accessible only from your machine.

**LAN access:** Set `gateway.bind` to `"lan"` to bind to `0.0.0.0`. Set `gateway.authToken` to require authentication for all API endpoints.

**Remote TUI:** Connect to a running KitnClaw instance from another terminal:

```bash
kitnclaw connect http://192.168.1.50:18800 --token your-secret-token
```

This opens a readline-based interactive session over WebSocket.

## Proactive Actions

KitnClaw can run tasks on a schedule using the `HEARTBEAT.md` file.

Create `~/.kitnclaw/workspace/HEARTBEAT.md` with natural-language schedules:

```markdown
## Morning Briefing
Every morning at 8am, check my calendar, summarize unread emails,
and give me a weather forecast for the day.

## Hourly News Check
Every 2 hours, scan tech news and save anything relevant to memory.

## Weekly Review
Every friday at 5pm, compile a summary of what I worked on this week
based on my recent conversations and memory.
```

KitnClaw parses the headings and body text, extracts schedule patterns (cron expressions), and runs them automatically via the built-in cron scheduler. Supported patterns include:

- `every hour`, `every N hours`
- `every morning/evening/day at Xam/pm`
- `every monday/tuesday/.../sunday at Xam/pm`
- `every week` / `weekly`

## Commands

All commands can be run either via global command (after `bun link`) or from source:

| Global command | From source | Description |
|---|---|---|
| `kitnclaw` | `bun run --cwd packages/claw dev` | Start the gateway (runs setup on first launch) |
| `kitnclaw setup` | `bun run --cwd packages/claw dev setup` | Configure provider, model, safety profile |
| `kitnclaw status` | `bun run --cwd packages/claw dev status` | Show current configuration and workspace stats |
| `kitnclaw connect <url>` | `bun run --cwd packages/claw dev connect <url>` | Connect to a remote gateway via WebSocket |
| `kitnclaw reset` | `bun run --cwd packages/claw dev reset` | Clear sessions, memory, or workspace data |

### Reset options

```bash
kitnclaw reset --sessions    # Clear conversation history
kitnclaw reset --memory      # Clear memory database
kitnclaw reset --workspace   # Clear workspace tools/agents
kitnclaw reset --all         # Clear everything
```

## Built-in Tools

KitnClaw ships with 12 built-in tools:

| Tool | Category | Description |
|---|---|---|
| `file-read` | Filesystem | Read file contents |
| `file-write` | Filesystem | Write to a file |
| `file-search` | Filesystem | Search for files by pattern |
| `bash` | System | Execute shell commands |
| `web-fetch` | Web | Fetch URL content |
| `web-search` | Web | Search the web |
| `memory-search` | Memory | Search saved memories |
| `memory-save` | Memory | Save information to memory |
| `kitn-registry-search` | Registry | Search the kitn component registry |
| `kitn-add` | Registry | Install a component from the registry |
| `create-tool` | Creation | Create a new custom tool |
| `create-agent` | Creation | Create a new custom agent |

## Directory Structure

```
~/.kitnclaw/
  kitnclaw.json          # Configuration
  claw.db                # Audit log, drafts, budgets (libSQL)
  credentials/           # Encrypted credential fallback storage
  sessions/              # Conversation history (.jsonl)
  memory/                # Memory database
  workspace/
    SOUL.md              # Personality customization
    HEARTBEAT.md         # Scheduled task definitions
    tools/               # User-created tools (.ts)
    agents/              # User-created agents (.ts)
    skills/              # User-created skills
  logs/                  # Application logs
```

## Development

```bash
# Install dependencies
bun install

# Build the claw package
bun run --cwd packages/claw build

# Run in development mode
bun run --cwd packages/claw dev

# Run tests
bun run --cwd packages/claw test

# Type-check
bun run --cwd packages/claw typecheck
```

## See Also

- [Security Documentation](docs/security.md) -- Detailed coverage of safety profiles, governance, budgets, audit logging, credential storage, multi-user access, and firewall rules.
