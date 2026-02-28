# API Example Modernization Design

**Goal:** Update `examples/api/` to be the comprehensive power-user showcase of everything kitn can do, with a developer-friendly README.

**Audience:** Developers who want to understand kitn internals and see every feature wired up manually. Points to `getting-started/` for the CLI-based easy path.

## Decisions

- **Keep name as `api/`** — no restructuring until a second framework example exists (YAGNI)
- **No kitn.json/kitn.lock** — this is the manual wiring example, not the CLI example
- **Power-user showcase** — demonstrates every kitn capability in one project

## What Stays (unchanged)

- Manual wiring pattern with `@kitnai/hono-adapter` workspace dep
- Agents: general (multi-tool), guarded (with guard function)
- Tools: echo, weather, calculator
- Orchestrator (autonomous routing)
- Voice providers (OpenAI, Groq) — conditional on env vars
- File storage with `data/` directory
- Resilience config (retries) and compaction config
- t3-env validation, Bun-native server
- Skills (markdown files in `data/skills/`)

## What Gets Added

### Cron Scheduling
- Wire `createInternalScheduler()` into plugin config via `cronScheduler`
- Register a sample cron job at startup: runs the general agent on a schedule
- Demonstrates: CronStore CRUD endpoints appear, InternalScheduler ticks, executeCronJob runs agents

### Commands
- Add a sample `status` command that returns server uptime and registered agent/tool counts
- Demonstrates the commands API endpoint

### Registry-Style Components
- Add web-search-tool (uses Brave Search API, key already in .env.example)
- Add hackernews-tool (no API key needed)
- Copied from registry source, not CLI-installed — shows manual + registry components coexist
- Wire into the general agent's tool set

## What Gets Updated

### README
- Rewritten for developer getting-started audience
- Sections: what this is, prerequisites, quick setup, feature overview, project structure, configuration, points to getting-started for CLI path, links to CLI install
- Mentions this is the "advanced/comprehensive" example

### env.ts
- Already has BRAVE_API_KEY — no changes needed for web search
- No new required env vars

### index.ts
- Wire cronScheduler into createAIPlugin config
- Register new tools
- Register sample command
- Start internal scheduler on server boot

### package.json
- No new deps needed — everything comes from workspace packages
