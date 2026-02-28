# kitn chat Design

## Problem

Developers using kitn need to manually figure out which components to install, create, and wire together. They must know the registry contents, understand dependencies, and run multiple CLI commands in sequence. This is friction — especially for new users who don't yet know what's available.

## Solution

An AI-powered scaffolding assistant accessed via `kitn chat`. The developer describes what they want in natural language. An LLM analyzes the request against the registry and project state, produces a structured plan of CLI actions, the developer confirms, and the CLI executes.

```bash
kitn chat "I want an agent that checks the weather and sends alerts to Slack"
```

## Architecture

Two sides — a **service** (kitn-powered API) and a **CLI command** (thin client).

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│  kitn chat "..."    │         │  packages/chat-service/          │
│                     │  POST   │                                  │
│  Gathers context:   │────────>│  Built with @kitnai/core +       │
│  - registry index   │         │  @kitnai/hono-adapter            │
│  - installed state  │         │                                  │
│  (from kitn.json)   │<────────│  Agent: "assistant"              │
│                     │  JSON   │  Guard: rejects off-topic        │
│  Renders plan       │         │  Tool: createPlan (structured)   │
│  User confirms      │         │                                  │
│  Executes actions   │         │  Returns: plan + summary         │
└─────────────────────┘         └──────────────────────────────────┘
```

**Service**: A Hono server using kitn's own plugin system. One agent ("assistant") with a guard and a structured output tool. Single endpoint: `POST /api/agents/assistant`. Fully open source — prompts, guard, everything visible. Dogfooding kitn's own framework.

**CLI**: New `kitn chat` command. Gathers registry index + installed state, sends to service, renders the plan with @clack/prompts, user confirms, executes actions by calling the same internal functions that `add`, `create`, `link`, `remove`, `unlink` use.

## Service (packages/chat-service/)

### Stack

- `@kitnai/core` + `@kitnai/hono-adapter`
- Single agent: `assistant`
- Single tool: `createPlan` (structured output via Zod schema)
- Guard: topic classifier that rejects anything outside kitn scaffolding
- Model: GPT-4o-mini (swappable server-side without CLI changes)

### The Assistant Agent

System prompt receives the registry index and installed state as context (injected from the request body metadata). The agent's job is narrow: understand the user's intent, match it against available/installed components, and produce a structured plan of CLI actions.

### The createPlan Tool

A tool with a Zod schema that forces structured output:

```ts
{
  summary: z.string(),        // "I'll set up a weather agent with Slack notifications"
  steps: z.array(z.object({
    action: z.enum(["add", "create", "link", "remove", "unlink"]),
    component: z.string().optional(),   // for add/remove: "weather-tool"
    type: z.string().optional(),        // for create: "agent" | "tool"
    name: z.string().optional(),        // for create: "slack-notifier"
    description: z.string().optional(), // for create: agent/tool description
    toolName: z.string().optional(),    // for link/unlink: tool to wire
    agentName: z.string().optional(),   // for link/unlink: target agent
    reason: z.string(),                 // why this step is needed
  }))
}
```

### The Guard

Uses kitn's existing guard pattern. Classifies the request — if it's not about setting up agents, tools, or components, it rejects with a helpful message.

Allowed topics:
- Adding, creating, removing agents/tools/skills/storage/packages
- Wiring tools to agents
- Questions about what's available in the registry

Rejected:
- General knowledge questions
- Code generation unrelated to kitn components
- Anything else

The guard is a simple system-prompt-based classification — "Is this request about setting up kitn AI components? Respond YES or NO." One cheap call with a few tokens.

### Request/Response

**Request** (from CLI):

```json
{
  "message": "I want an agent that checks the weather and sends alerts to Slack",
  "metadata": {
    "registryIndex": [
      { "name": "weather-tool", "type": "kitn:tool", "description": "Open-Meteo weather data", "dependencies": [] }
    ],
    "installed": ["core", "hono", "general-agent", "echo-tool"]
  }
}
```

**Response** (plan):

```json
{
  "response": {
    "summary": "I'll set up a weather-and-slack agent...",
    "steps": [
      { "action": "add", "component": "weather-tool", "reason": "Provides weather data" },
      { "action": "create", "type": "tool", "name": "slack-notify", "description": "Sends messages to Slack", "reason": "No Slack tool in registry" },
      { "action": "create", "type": "agent", "name": "weather-slack", "description": "Checks weather and alerts via Slack", "reason": "Custom agent" },
      { "action": "link", "toolName": "weather-tool", "agentName": "weather-slack", "reason": "Agent needs weather data" },
      { "action": "link", "toolName": "slack-notify", "agentName": "weather-slack", "reason": "Agent needs Slack" }
    ]
  }
}
```

**Guard rejection**:

```json
{
  "rejected": true,
  "message": "I can only help with setting up kitn components. Try something like 'I need an agent that summarizes articles'."
}
```

### Token Budget

- System prompt (role + instructions): ~300 tokens
- Registry index (~15-20 components): ~400 tokens
- Installed state: ~100 tokens
- User message: ~50 tokens
- Response (plan): ~200 tokens
- **Total: ~1,000-1,100 tokens per request**

### Prompt Design

System prompt sections:

1. **Role** — "You are the kitn assistant. You help developers set up AI agents and tools using the kitn registry."
2. **Available components** — Registry index, injected as a compact list (name, type, description, dependencies)
3. **Installed components** — What's already in the project
4. **Instructions** — "Analyze the request. Use available components when they exist. Suggest creating new ones when they don't. Call the createPlan tool with your plan."
5. **Constraints** — "Only plan actions for: add, create, link, remove, unlink. Don't suggest code changes. Don't explain how components work internally."

## CLI Command (kitn chat)

### Invocation

```bash
kitn chat "I want a weather agent that sends alerts to Slack"
```

### Flow

1. **Gather context** — Read `kitn.json` for installed components. Fetch the registry index (same mechanism `kitn list` uses).
2. **Call the service** — POST to the configured service URL with the user's request + context. Single JSON response, no streaming.
3. **Render the plan** — Display the summary and each step using @clack/prompts.
4. **Confirm** — Three options: "Yes, run all steps", "Select which steps to run" (multi-select), "Cancel".
5. **Execute** — Runs each confirmed step by calling the same internal functions the CLI commands use (direct function calls, not shelling out). Shows a spinner per step with success/failure status.
6. **Summary** — After execution, show what was done and what failed (if anything).

### Plan Rendering

```
◆  kitn assistant

   I'll set up a weather-and-slack agent using the existing
   weather tool and a new Slack notification tool.

   1. Add weather-tool          — Provides weather data via Open-Meteo API
   2. Create tool slack-notify   — Sends messages to a Slack channel
   3. Create agent weather-slack — Checks weather and sends alerts to Slack
   4. Link weather-tool → weather-slack
   5. Link slack-notify → weather-slack

◆  Execute this plan?
   > Yes, run all steps
     Select which steps to run
     Cancel
```

### Execution Output

```
◇  Executing plan...

✓  Added weather-tool
✓  Created tool slack-notify at src/ai/tools/slack-notify.ts
✓  Created agent weather-slack at src/ai/agents/weather-slack.ts
✓  Linked weather-tool → weather-slack
✓  Linked slack-notify → weather-slack

◇  All done! Run your dev server to test the new agent.
```

### Configuration

Service URL defaults to `https://chat.kitn.dev`. Overridable via:

1. `KITN_CHAT_URL` environment variable (highest priority)
2. `chatService.url` field in `kitn.json`
3. Default: `https://chat.kitn.dev`

```json
{
  "chatService": {
    "url": "https://chat.kitn.dev"
  }
}
```

For self-hosters:

```json
{
  "chatService": {
    "url": "http://localhost:4002"
  }
}
```

Authentication via `KITN_API_KEY` environment variable (for future metering on the hosted service).

### Error Handling

- Service unreachable → clear error message suggesting checking connection or configuring custom URL
- Guard rejection → display the rejection message directly
- Partial execution failure → continue remaining steps, show which failed at the end

## Self-Hosting & Deployment

### Local Development

```bash
bun run --cwd packages/chat-service dev
# or from root:
bun run dev:chat
```

### Self-Hosting

1. Clone or install the package
2. Set API key (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, etc.)
3. Run: `docker run` or `bun run start` or deploy to any container host
4. Point CLI: `KITN_CHAT_URL=http://localhost:4002`

### Dockerfile

Lives in `packages/chat-service/`. Standard multi-stage build. Works with Doploy, Railway, Fly, any container host.

### Environment Variables (Service)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) | LLM provider key |
| `PORT` | Server port (default: 4002) |
| `KITN_API_KEY` | Optional — authenticates CLI requests when metering is added |

## File Structure

### Service Package

```
packages/chat-service/
├── package.json            # @kitnai/chat-service
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── index.ts            # Hono server entry point, plugin wiring
│   ├── agents/
│   │   └── assistant.ts    # Assistant agent definition + guard
│   ├── tools/
│   │   └── create-plan.ts  # createPlan tool with Zod schema
│   └── prompts/
│       └── system.ts       # System prompt template
└── test/
    └── assistant.test.ts   # Test scenarios
```

### CLI Addition

```
packages/cli/src/commands/chat.ts    # New command
packages/cli/src/index.ts            # Register the command
```

### Dependencies (Service)

```json
{
  "dependencies": {
    "@kitnai/core": "workspace:*",
    "@kitnai/hono-adapter": "workspace:*",
    "hono": "^4",
    "@ai-sdk/openai": "^1",
    "ai": "^4"
  }
}
```

## Boundaries — What We Don't Build (v1)

| Concern | Stance | Rationale |
|---------|--------|-----------|
| Multi-turn conversation | No | Single prompt → plan → execute. Keeps tokens low. |
| Code generation | No | Plans CLI actions, doesn't write implementation code. |
| Project code scanning | No | Only registry index + kitn.json. No source sent to service. |
| Billing/metering | Not in v1 | Free for now. `KITN_API_KEY` ready for later. |
| Model selection UI | No | Model is a server-side decision. |
| Conversation history | No | Each `kitn chat` call is stateless. |
| Custom registries | Defer | v1 only considers the default @kitn registry index. |

## Open Source

The entire service is open source — prompts, guard logic, agent configuration, everything. Developers can:

- Inspect exactly what happens with their request
- Self-host to avoid any service dependency
- Contribute improvements to the prompts and tools
- Use it as a reference for building their own kitn-powered services
