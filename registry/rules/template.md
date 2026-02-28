# kitn AI Agent Framework

This project uses **kitn** to build multi-agent AI systems. kitn is a TypeScript framework with a component registry (like shadcn/ui for AI agents).

## Project Structure

AI components live under the `{base}` directory:

```
{base}/
  plugin.ts        # AI plugin configuration (model, storage, voice)
  index.ts         # Barrel file — auto-imports all registered components
  {agents}/        # Agent definitions
  {tools}/         # Tool definitions
  {skills}/        # Skill files (markdown with frontmatter)
  {storage}/       # Storage provider implementations
  {crons}/         # Cron job definitions
```

The `kitn.json` config file in the project root defines these paths and the component registry.

## Component Patterns

### Agent

Agents use `registerAgent()` for self-registration. Each agent file exports nothing directly — the side-effect import in the barrel file triggers registration.

```typescript
import { registerAgent } from "@kitn/core";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "my-agent",
  description: "What this agent does",
  system: SYSTEM_PROMPT,
  tools: {
    // Wire tools here — see "Wiring Tools to Agents" below
  },
});
```

### Tool

Tools use the Vercel AI SDK `tool()` function and `registerTool()` for self-registration.

```typescript
import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const myTool = tool({
  description: "What this tool does",
  parameters: z.object({
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    return { result: input };
  },
});

registerTool({
  name: "my-tool",
  description: "What this tool does",
  inputSchema: z.object({ input: z.string() }),
  tool: myTool,
});
```

### Skill

Skills are markdown files with YAML frontmatter. They provide reusable system prompt fragments.

```markdown
---
name: my-skill
description: "What this skill does"
---

Instructions for the AI agent when this skill is active.
```

### Cron

Cron jobs are tools that run on a schedule, registered the same way as regular tools. Schedules are managed via the cron API routes.

## Wiring Tools to Agents

To give an agent access to a tool, import the tool and add it to the agent's `tools` object:

```typescript
import { registerAgent } from "@kitn/core";
import { myTool } from "../tools/my-tool.js";

registerAgent({
  name: "my-agent",
  description: "Agent with tools",
  system: "You are a helpful assistant.",
  tools: {
    myTool,
  },
});
```

The key name in the `tools` object is how the AI model references the tool. Use camelCase.

## Self-Registration Pattern

kitn uses a side-effect import pattern. Every agent and tool file calls `registerAgent()` or `registerTool()` at module load time. The barrel file (`{base}/index.ts`) imports all components:

```typescript
import "./{agents}/weather-agent.js";
import "./{tools}/weather.js";
export { registerWithPlugin } from "@kitn/core";
```

The `registerWithPlugin` export flushes all registered components into the plugin instance. This pattern means:

- **No manual wiring** — adding a component to the barrel file is enough
- **Tree-shakeable** — only imported components are included
- **Order-independent** — registration is collected, then flushed

## Import Conventions

- Always use `.js` extension in relative imports (TypeScript compiles to JS)
- Use `@kitn/core` for core framework imports (`registerAgent`, `registerTool`, types)
- Use `@kitn/adapters/hono` (or `/hono-openapi`, `/elysia`) for adapter imports
- Use `ai` package for Vercel AI SDK functions (`tool`, `streamText`, `generateText`)
- Use `zod` for schema definitions

## CLI Quick Reference

| Command               | Description                                    |
|-----------------------|------------------------------------------------|
| `kitn init`           | Initialize kitn in your project                |
| `kitn add <name>`     | Install a component from the registry          |
| `kitn create <type> <name>` | Scaffold a new component locally         |
| `kitn link tool <name> --to <agent>` | Wire a tool to an agent         |
| `kitn unlink tool <name> --from <agent>` | Unwire a tool from an agent  |
| `kitn list`           | List available and installed components        |
| `kitn diff <name>`    | Show changes between local and registry        |
| `kitn update`         | Update installed components to latest           |
| `kitn remove <name>`  | Remove an installed component                  |
| `kitn rules`          | Regenerate AI coding tool rules files          |

## Common Tasks

### Create a new agent

```bash
kitn create agent my-agent
```

This scaffolds `{agents}/my-agent.ts` with a starter template and wires it into the barrel file.

### Create a new tool

```bash
kitn create tool my-tool
```

This scaffolds `{tools}/my-tool.ts` with a Vercel AI SDK tool template and wires it into the barrel file.

### Wire a tool to an agent

```bash
kitn link tool my-tool --to my-agent
```

This adds the tool import and wires it into the agent's `tools` object.

### Install a component from the registry

```bash
kitn add weather-agent
```

This fetches the component source from the registry, writes it to the correct directory, installs any npm dependencies, and wires it into the barrel file.

### Install multiple components

```bash
kitn add weather-agent calculator-tool echo-tool
```

### Browse available components

```bash
kitn list           # all components
kitn list agents    # only agents
kitn list -i        # only installed
```
