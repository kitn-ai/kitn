# KitnClaw — General-Purpose AI Assistant

**Date:** 2026-03-02
**Status:** Approved

## Overview

KitnClaw is a general-purpose AI assistant built on the kitn AI agent toolkit. It follows the same model as OpenClaw — a personal AI assistant that can handle daily tasks (email, messaging, research, automation, file management) — but with kitn's architectural advantages: source-code components, a component registry, dynamic self-modification, and a lightweight install.

**Key differentiators over OpenClaw:**
- **Dynamic creation**: The agent can create new tools, agents, and skills on the fly by writing source files. Hot-reload picks them up immediately.
- **Registry ecosystem**: Components install via `kitn add`. Users and community members publish to registries. The agent can search and install from registries autonomously.
- **Lightweight**: No 1.4GB install. Core tools are built in; everything else is opt-in via registry.
- **Secure by default**: Tiered permission model (safe/moderate/dangerous) with user trust lists. No exposed ports, no plaintext credential disasters.
- **Built on @kitnai/core**: Battle-tested agent runtime, tool registry, storage system, and memory.

**What kitn is:** An AI agent toolkit — batteries-included building blocks for multi-agent AI systems. KitnClaw is the flagship product built on the toolkit, proving what it can do.

## Architecture: Gateway Process

A single long-running Bun process (the "gateway") manages everything. Multiple clients (terminal TUI, Discord bot, Telegram bot, WhatsApp bridge, future web UI) connect to it. Each gets its own session with serial execution.

```
                    ┌─────────────────────────────────────────────┐
                    │              KitnClaw Gateway                │
                    │                                             │
                    │  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
                    │  │  Agent    │  │  Tool     │  │ Channel │ │
                    │  │  Runtime  │  │  Registry │  │ Manager │ │
                    │  │ (@kitnai/ │  │ (@kitnai/ │  │         │ │
                    │  │  core)    │  │  core)    │  │         │ │
                    │  └───────────┘  └───────────┘  └─────────┘ │
                    │  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
                    │  │  Session  │  │  Memory   │  │ Perm.   │ │
                    │  │  Store    │  │  (libSQL) │  │ Manager │ │
                    │  └───────────┘  └───────────┘  └─────────┘ │
                    │  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
                    │  │  MCP      │  │  Registry │  │ Hot-    │ │
                    │  │  Client   │  │  Fetcher  │  │ reload  │ │
                    │  └───────────┘  └───────────┘  └─────────┘ │
                    └──────┬──────────┬──────────┬────────────────┘
                           │          │          │
                     ┌─────┴──┐ ┌─────┴──┐ ┌────┴────┐ ┌────────┐
                     │Terminal│ │Discord │ │Telegram │ │WhatsApp│
                     │  TUI   │ │  Bot   │ │  Bot    │ │ Bridge │
                     └────────┘ └────────┘ └─────────┘ └────────┘
```

### Why a single gateway process

- **Simple state**: No IPC, no serialization, no distributed coordination
- **Serial execution per session**: One message at a time per conversation prevents race conditions
- **Hot-reload friendly**: File watcher re-imports changed modules instantly
- **@kitnai/core in-process**: Agent runtime, tool registry, and storage all work natively
- **Multiple TUI instances**: Each terminal opens a new session against the same gateway

### Config file (`~/.kitnclaw/kitnclaw.json`)

```json
{
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4-5",
  "channels": {
    "terminal": { "enabled": true },
    "discord": { "token": "..." },
    "telegram": { "token": "..." },
    "whatsapp": { "enabled": true }
  },
  "mcpServers": {
    "kitn": { "command": "kitn", "args": ["mcp"] }
  },
  "permissions": {
    "trusted": ["file-read", "web-search", "weather-tool"],
    "requireConfirmation": ["file-write", "bash"],
    "denied": []
  },
  "registries": {
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json"
  }
}
```

### Workspace directory (`~/.kitnclaw/`)

```
~/.kitnclaw/
  kitnclaw.json          Config
  sessions/              Conversation history (JSONL per session)
  memory/                Long-term memory (libSQL with native vector search)
  workspace/
    agents/              User/AI-created agents
    tools/               User/AI-created tools
    skills/              Markdown skill files
    SOUL.md              Personality/tone (optional)
  credentials/           API keys (0600 permissions)
  logs/                  Debug logs
```

## Package Structure

```
packages/
  claw/                 @kitnai/claw — the gateway + TUI
    src/
      gateway/          Gateway process (startup, config, lifecycle)
      channels/         Channel abstraction layer + terminal channel
      agent/            Agent loop wrapper (wraps @kitnai/core runAgent)
      tools/            Built-in tools (bash, file, web, etc.)
      permissions/      Permission manager (safe/moderate/dangerous + trust lists)
      sessions/         Session persistence (JSONL per conversation)
      memory/           Long-term memory (libSQL vector + keyword search)
      tui/              OpenTUI React components
      config/           Configuration (kitnclaw.json)
      index.ts          Entry point: kitnclaw CLI

registry/
  components/
    channels/
      discord-channel/     kitn:channel — Discord bot adapter
      telegram-channel/    kitn:channel — Telegram bot adapter
      whatsapp-channel/    kitn:channel — WhatsApp bridge adapter
```

**Dependencies:**
- `@kitnai/core` — agent runtime, tool/agent registries, storage
- `@opentui/core` + `@opentui/react` — terminal UI framework
- `@libsql/client` — libSQL for sessions + vector memory
- `ai` (Vercel AI SDK v6) — LLM provider abstraction
- Channel SDKs installed on-demand via registry components

## Channel Abstraction

Every messaging platform implements the same interface:

```typescript
interface Channel {
  name: string;
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  send(sessionId: string, msg: OutboundMessage): Promise<void>;
}

interface InboundMessage {
  sessionId: string;           // channel:userId or channel:groupId
  userId: string;
  text: string;
  attachments?: Attachment[];  // images, files, audio
  replyTo?: string;            // thread/reply context
  platform: string;            // "terminal" | "discord" | "telegram" | "whatsapp"
}

interface OutboundMessage {
  text: string;                // markdown
  toolCalls?: ToolCallInfo[];  // for platforms that can render them
  attachments?: Attachment[];
}
```

- **Terminal channel** is built into `@kitnai/claw`
- **Discord, Telegram, WhatsApp** are registry components installed via `kitn add`
- The gateway's hot-reload watcher picks up new channel files automatically
- Each adapter normalizes platform-specific formats to/from these interfaces

## Terminal UI (OpenTUI)

The primary interface — a rich chat REPL built with OpenTUI React:

```
┌─ KitnClaw ──────────────────── claude-sonnet-4-5 via openrouter ─┐
│                                                                    │
│  You: What's the weather in Tokyo?                                │
│    > weather-tool({ location: "Tokyo" })                          │
│  Agent: Tokyo is 18C and partly cloudy with 65% humidity.         │
│                                                                    │
│  You: Check my Discord for mentions                               │
│    ! discord-read requires confirmation [Y/n]                     │
│  You: y                                                            │
│    > discord-read({ channel: "general", count: 10 })              │
│  Agent: You have 3 mentions in #general...                        │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  Type a message... (Ctrl+Q quit, /help commands)                  │
└────────────────────────────────────────────────────────────────────┘
```

**Components:**
- `<Header>` — branding, current model/provider, status indicators
- `<Messages>` — scrollable chat with markdown rendering, tool call cards, permission prompts
- `<Input>` — multi-line text input with slash commands
- `<PermissionPrompt>` — inline confirmation for moderate/dangerous actions
- `<ToolCard>` — tool execution status (pending -> running -> completed)

**Slash commands:**
- `/model <name>` — switch model
- `/session list|new|resume` — manage conversation sessions
- `/add <component>` — install a registry component
- `/skills` — list available skills
- `/channels` — show connected channels
- `/permissions` — view/edit permission settings
- `/clear` — clear current session
- `/exit` — shut down gateway

## Built-in Tools

| Tool | Category | Permission |
|---|---|---|
| `file-read` | File | safe |
| `file-write` | File | moderate |
| `file-search` (glob/grep) | File | safe |
| `bash` | Shell | dangerous |
| `web-fetch` | Web | safe |
| `web-search` | Web | safe |
| `memory-search` | Memory | safe |
| `memory-save` | Memory | safe |
| `kitn-registry-search` | Registry | safe |
| `kitn-add` | Registry | moderate |
| `create-tool` | Dynamic | moderate |
| `create-agent` | Dynamic | moderate |

**Dynamic creation** (`create-tool`, `create-agent`): The agent writes source files to the workspace. The hot-reload watcher re-imports and registers them with `@kitnai/core`. The agent knows kitn's patterns via system prompt context and skills.

## Permission System

Three tiers with user trust lists:

| Tier | Examples | Default |
|---|---|---|
| **Safe** | file-read, web-search, memory | Auto-execute |
| **Moderate** | file-write, API calls, kitn-add | Prompt once, remember for session |
| **Dangerous** | bash, send-message, delete-file | Always prompt unless in trusted list |

**Trust list**: Users permanently trust specific tools in config so they stop getting prompted. Inline permission prompts in the TUI — agent response pauses, shows tool call, asks Y/n, continues.

**Future (V2)**: Sandboxing via Docker/Podman as an opt-in for maximum security.

## Hot-Reload & Dynamic Self-Modification

This is KitnClaw's key differentiator. The gateway watches `~/.kitnclaw/workspace/` for changes:

1. User says: "I need a tool that checks Bitcoin prices"
2. Agent searches the registry — no `bitcoin-tool` found
3. Agent uses `create-tool` to write `workspace/tools/bitcoin-price.ts`
4. File watcher detects the new file
5. Gateway re-imports the module, calls `registerTool()` on the @kitnai/core plugin
6. Tool is immediately available for the agent to use
7. Agent calls `bitcoin-price({ symbol: "BTC" })` and returns the result

Same flow for agents, skills, and even channel adapters. The agent can also use `kitn-add` to pull existing components from any configured registry.

## Memory (libSQL)

Long-term memory using libSQL with native vector search:

- **Vector embeddings**: Automatic embedding of conversation summaries and important facts
- **Keyword search**: FTS5 full-text search for precise recall
- **Hybrid retrieval**: Combine vector similarity + keyword matching for best results
- **Per-agent memory**: Each agent can have its own memory namespace
- **Session summaries**: Automatic summarization of completed sessions into memory

libSQL chosen over SQLite + sqlite-vec because:
- Native vector search (no extension to compile/install)
- DiskANN algorithm for fast approximate nearest neighbor
- Optional Turso cloud sync for backup
- Drop-in SQLite compatibility

## Session Persistence

Conversations persist as JSONL files (one per session):

```
~/.kitnclaw/sessions/terminal-user-abc123.jsonl
~/.kitnclaw/sessions/discord-user-456.jsonl
```

Each line is a JSON event:
```json
{"type":"user","text":"...","timestamp":1709337600}
{"type":"assistant","text":"...","toolCalls":[...],"timestamp":1709337605}
{"type":"tool","name":"weather","input":{...},"result":{...},"timestamp":1709337603}
```

Sessions can be resumed via `/session resume` in the TUI or by continuing a conversation on a messaging platform.

## Deprecations

As part of this work, remove:
- `packages/chat-service/` — replaced by KitnClaw
- `kitn chat` / `kitn code` CLI command — removed from `packages/cli/src/index.ts`
- `kitn config` command — was only for chat-url and api-key
- Related tests and documentation

## Future (V2+)

- **Web UI channel**: Browser-based interface connecting to the gateway
- **Sandboxing**: Docker/Podman opt-in for tool execution isolation
- **Multi-user**: Access control for shared gateway instances
- **Proactive actions**: Scheduled tasks, monitoring, HEARTBEAT.md-style checklists
- **Voice**: Integrate @kitnai/core's voice capabilities
- **Mobile**: Expose gateway via Tailscale/tunnel for phone access

## Key References

- OpenClaw architecture: [GitHub](https://github.com/openclaw/openclaw)
- OpenTUI: [GitHub](https://github.com/sst/opentui)
- libSQL vector search: [Turso docs](https://turso.tech/vector)
- btca (OpenTUI reference app): [GitHub](https://github.com/davis7dotsh/better-context)
- kitn core: `packages/core/src/`
- kitn self-registration: `packages/core/src/registry/self-register.ts`
- kitn MCP server: `packages/mcp-server/src/`
