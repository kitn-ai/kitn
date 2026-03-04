# KitnClaw Roadmap

What's been shipped, what's next, and where this is all going.

---

## Shipped

### V1 — Core Gateway + Terminal + Channels (Epic 1)

The foundation. A working personal AI assistant with a terminal TUI, built-in tools, permissions, sessions, memory, and dynamic self-extension.

- Package scaffolding, monorepo integration, Bun build pipeline
- Config system (`~/.kitnclaw/kitnclaw.json`) with Zod validation
- Gateway process with `@kitnai/core` plugin (registries, storage, model factory)
- 12 built-in tools (filesystem, shell, web, memory, registry, creation)
- Permission system with three safety profiles (cautious, balanced, autonomous)
- Per-tool argument firewall rules (path patterns, command patterns)
- JSONL session persistence (`~/.kitnclaw/sessions/`)
- libSQL memory store with FTS5 full-text search
- Serial session queue (one message at a time per session)
- Terminal TUI via `@opentui/react` (messages, tool cards, permission prompts, slash commands)
- Channel abstraction (`Channel`, `InboundMessage`, `OutboundMessage`)
- Channel manager with routing and lifecycle
- Hot-reload file watcher for workspace tools/agents/skills
- Dynamic tool and agent creation (AI writes TypeScript, watcher picks it up)
- Registry integration (search and install components at runtime)
- Agent loop with system prompt assembly, SOUL.md personality, skill injection
- Setup wizard (interactive first-run configuration)
- Deprecation of `kitn chat` / `kitn config` commands

### V2 — Security, Remote Access, Web UI (Epic 2)

Hardening and expanding access beyond the terminal.

- Granular permission policies: per-tool argument validation, per-channel overrides, rate limiting
- Governance system: action approval modes (auto/draft/blocked), budget tracking, draft queue
- Audit logging to libSQL (tool executions, decisions, durations)
- Credential encryption fallback storage
- Embedded HTTP server (Bun.serve): health, status, message, SSE, WebSocket endpoints
- Web chat UI (embedded HTML/CSS/JS, dark theme, tool cards, auth, markdown rendering)
- WebSocket remote TUI (`kitnclaw connect <url>`)
- LAN binding option (`gateway.bind: "lan"`)
- Multi-user access control (operator/user/guest roles, per-channel permissions)
- Channel-level pairing codes (single-use, expiring, for onboarding unknown users)
- Cron scheduler integration (`@kitnai/core` InternalScheduler)
- HEARTBEAT.md natural-language schedule parser

---

## Next Up

### Web Application — `claw-web`

A proper web frontend for KitnClaw, replacing the embedded single-file HTML chat UI with a real application. Ships as a separate package (`packages/claw-web`) with its own build pipeline.

**Why:** The current embedded web UI works but is limited — no component library, no state management, no offline support, no installability. A standalone web app enables a much richer experience and opens the door to PWA/mobile.

**Scope:**

- **Framework:** Solid.js (consistent with the existing `examples/app/` frontend) or React (consistent with the TUI). Solid is lighter and faster; the kitn ecosystem already has a Solid example.
- **Build:** Vite, outputs static assets that can be served by the gateway's HTTP server or deployed standalone.
- **Core features:**
  - Multi-session management (create, switch, delete, rename sessions)
  - Real-time streaming responses via SSE or WebSocket
  - Rich markdown rendering (syntax-highlighted code blocks, tables, LaTeX)
  - Tool call visualization (expandable cards with input/output, execution status, duration)
  - Permission prompt UI (approve/deny/always-trust buttons, inline in conversation flow)
  - File attachment support (drag-and-drop, paste images)
  - Command palette (slash commands, model switching, session management)
  - Auth flow (token entry, persistent via localStorage, logout)
  - Mobile-responsive layout (works on phones over Tailscale or LAN)
  - Dark/light theme with system preference detection
  - Keyboard shortcuts (Enter to send, Shift+Enter for newline, Ctrl+K for command palette)
- **API integration:**
  - `POST /api/message` for sending messages
  - `GET /api/stream?sessionId=` for SSE push updates
  - `WS /ws` for WebSocket bidirectional communication
  - `GET /api/status` for server health and model info
  - New endpoints as needed: `GET /api/sessions`, `DELETE /api/sessions/:id`, etc.
- **Gateway changes:**
  - Add session management API endpoints
  - Serve the built web app's static assets at `GET /` (replacing the embedded HTML string)
  - Keep the embedded HTML as a fallback if `claw-web` is not installed
- **Package structure:**
  ```
  packages/claw-web/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      api/          — API client (fetch wrappers, SSE/WS connection managers)
      components/   — UI components (MessageBubble, ToolCard, Input, Sidebar, etc.)
      stores/       — State management (sessions, messages, auth, settings)
      styles/       — Global styles, theme variables
      utils/        — Markdown renderer, keyboard shortcuts, formatters
  ```

**Milestone:** When this ships, `GET /` on a running KitnClaw instance serves a polished, app-quality chat interface instead of the current minimal embedded page.

---

## Roadmap Items

The following items are planned but not yet scheduled. They're roughly ordered by value and feasibility.

### 1. MCP Server Consumption

Wire up the `mcpServers` config field that's already defined in the schema but not connected at runtime. When KitnClaw starts, it should spawn configured MCP servers as child processes, discover their tools, and register them alongside built-in tools.

**Details:**
- Spawn each MCP server via stdio transport using the configured `command`, `args`, and `env`
- Use the MCP client protocol to list available tools from each server
- Register discovered tools in the `ToolRegistry` with a namespace prefix (e.g., `mcp:server-name:tool-name`)
- Permission system applies to MCP tools the same as built-in tools
- Graceful shutdown: kill MCP server processes on gateway exit
- Health monitoring: restart crashed MCP servers, log failures to audit

**Why it matters:** This turns KitnClaw into a universal MCP host. Users can connect any MCP server (file managers, databases, APIs, code tools) and the AI assistant can use them all through a single interface.

### 2. Voice Integration

Add speech-to-text and text-to-speech capabilities so users can talk to KitnClaw.

**Speech-to-text options:**
- OpenAI Whisper API (cloud, high quality)
- Local Whisper via Ollama or whisper.cpp (privacy, no API cost)
- Browser Web Speech API (for the web UI, zero setup)

**Text-to-speech options:**
- OpenAI TTS API (natural voices, cloud)
- ElevenLabs (premium voice cloning)
- Piper TTS (local, open source, fast)
- Browser Speech Synthesis API (for the web UI, zero setup)

**Integration points:**
- Terminal: microphone input via system audio APIs (portaudio or similar)
- Web UI: MediaRecorder API for recording, Web Audio API for playback
- Messaging channels: Telegram and WhatsApp voice messages auto-transcribed on receipt, responses optionally sent as voice notes
- `@kitnai/core` already has voice manager infrastructure — evaluate whether to reuse or build fresh

**Stretch — Voice channel:**
A dedicated real-time voice conversation mode. WebRTC or WebSocket audio streaming for low-latency back-and-forth. Think "Hey Siri" but it's your personal AI assistant. This is significantly more complex than basic STT/TTS.

### 3. Progressive Web App (PWA)

Upgrade `claw-web` to a full PWA so it's installable on iOS and Android.

**Features:**
- Service worker for offline caching of the app shell
- Web app manifest (icons, splash screen, standalone display mode)
- Push notifications for async agent responses (agent finishes a long task while you're away)
- Offline message queue (messages saved locally in IndexedDB, sent when reconnected)
- Background sync for pending messages
- Works seamlessly over Tailscale (access your home KitnClaw from your phone anywhere)

**Prerequisites:** `claw-web` must ship first.

### 4. Advanced Memory — RAG Pipeline

Retrieval-Augmented Generation: let users build a personal knowledge base that the AI assistant queries automatically.

**Document ingestion:**
- `/knowledge add <url>` — fetch and index a web page
- `/knowledge add <file>` — index a local file (PDF, markdown, plain text)
- Drag-and-drop in web UI to add documents
- Automatic chunking (semantic splitting, respecting section boundaries)

**Storage:**
- Chunks stored in libSQL with vector embeddings (`F32_BLOB`)
- Embeddings generated via the configured AI provider's embedding model
- FTS5 index for keyword search alongside vector similarity
- Hybrid scoring: weighted combination of cosine similarity + BM25

**Retrieval:**
- Agent automatically queries knowledge base when user asks about indexed topics
- Configurable retrieval: top-K chunks, similarity threshold, namespace filtering
- Source attribution in responses ("Based on your document X...")
- `/knowledge search <query>` for manual search

**Management:**
- `/knowledge list` — show indexed documents
- `/knowledge remove <id>` — remove a document and its chunks
- Storage stats in `kitnclaw status` output

### 5. Knowledge Graphs

Build a lightweight knowledge graph alongside vector memory for structured fact retrieval.

**Extraction:**
- Entity and relationship extraction from conversations (NER + relation classification)
- Can use the AI model itself or a smaller specialized model
- Entities: people, places, organizations, projects, concepts
- Relationships: "works at", "lives in", "is related to", "mentioned on <date>"

**Storage:**
- Graph stored in libSQL (nodes table + edges table)
- Temporal awareness: when was each fact learned? From which conversation?
- Confidence scores on edges (mentioned once vs. confirmed multiple times)

**Querying:**
- "What do I know about X?" triggers a graph traversal
- Agent can query the graph as a tool (`knowledge-graph-query`)
- Combine graph results with vector search for richer context

### 6. Context Compaction

Robust context management when conversations exceed the model's token limit. This was a major pain point in OpenClaw.

**Strategy:**
- Monitor token count as conversation grows
- When approaching the limit, summarize older messages into a compact summary
- Preserve key facts in memory store before discarding original messages
- Never lose tool results, important decisions, or user preferences
- Use `@kitnai/core`'s existing `compactConversation()` as the foundation
- Configurable compaction threshold and summary length

**What to preserve:**
- Most recent N messages (always kept in full)
- Tool call results that are still referenced
- User-stated preferences and corrections
- Key decisions and their reasoning

### 7. Community Registry — Channels as Components

Add `kitn:channel` as a new component type so channels are installable via `kitn add`.

**Changes needed:**
- New component type in `cli-core` (type definition, build pipeline, manifest schema)
- Channel components include: source code, manifest with config schema, README
- `kitn add discord-channel` installs to the workspace, watcher picks it up
- Channel-specific config merged into `kitnclaw.json` on install

**Initial channels to publish:**
- `discord-channel` — Discord bot via discord.js (DMs, server mentions, threaded sessions, embed conversion)
- `telegram-channel` — Telegram bot via grammY (private messages, group mentions, inline keyboards for permissions)
- `whatsapp-channel` — WhatsApp bridge via Baileys (QR pairing, media attachments, formatting limitations)
- `slack-channel` — Slack bot (workspace integration, threaded conversations)
- `matrix-channel` — Matrix/Element integration (E2EE, decentralized)

### 8. Community Skill Registry

Allow users to publish and discover skills (markdown instruction files) through a registry.

**Publishing:**
- Skills are markdown files with YAML frontmatter (name, description, author, tags)
- `kitn publish skill my-skill.md` pushes to the registry
- Versioning and changelogs

**Discovery:**
- `kitn search skills --tag coding` finds relevant skills
- Agent can search and install skills at runtime via built-in tools
- Skill descriptions indexed for semantic search

**Trust and verification:**
- Automated scanning pipeline for published skills:
  - Prompt injection pattern detection
  - External URL fetching analysis
  - Data exfiltration attempt detection
  - Excessive permission request flagging
- Trust scores: verified (scanned + manual review), scanned (automated only), unverified
- Unverified skills require explicit user approval before installation
- Report mechanism for malicious skills

**Why this matters:** OpenClaw's ClawHub has a 36% prompt injection rate in community skills. A verification pipeline from day one prevents this.

### 9. Native Mobile App (Stretch)

A React Native or Expo app for a polished mobile experience beyond what the PWA provides.

**Features:**
- Native push notifications (more reliable than web push)
- Voice input with always-on listening option
- Biometric authentication (Face ID / fingerprint)
- Share sheet integration (share text/images/URLs to KitnClaw)
- Background processing and notification grouping
- Connects to the gateway via Tailscale or LAN

**Prerequisites:** PWA should ship first to validate the mobile use case before investing in native.

### 10. KitnClaw Hub (Stretch)

A web platform for the KitnClaw community.

**Content:**
- Verified skills with trust scores and reviews
- Channel adapters (community-contributed messaging integrations)
- Tool packs (curated collections of related tools)
- Agent templates (pre-configured agents for specific use cases)
- TUI themes (color schemes and layouts)

**For non-technical users — Hosted KitnClaw:**
- Cloud-hosted version that doesn't require running a local gateway
- Turso for cloud libSQL storage
- Server-side agent execution
- Web UI only (no terminal TUI)
- BYOK (Bring Your Own API Key) or metered billing
- Free tier with limited messages per month, paid plans for unlimited use

---

## Status Key

| Status | Meaning |
|--------|---------|
| **Shipped** | Released, tested, merged to main |
| **Next Up** | Actively being worked on or about to start |
| **Planned** | Designed but not yet started |
| **Stretch** | Aspirational, depends on demand and resources |
