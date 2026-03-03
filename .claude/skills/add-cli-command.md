---
name: add-cli-command
description: Add a new CLI command to @kitnai/cli following the two-layer pattern (cli-core logic + CLI wrapper)
---

# Add a CLI Command

Commands are split into two layers:

- **`cli-core`** — pure logic: takes all inputs upfront, returns structured results, no UI
- **`cli`** — thin UI wrapper: prompts for missing inputs, calls cli-core, formats output

## 1. Create core logic in cli-core

Create `packages/cli-core/src/commands/<name>.ts`:

```ts
import { readConfig, readLock } from "../config/io.js";
import type { KitnConfig, LockFile } from "../types/config.js";

export interface <Name>Opts {
  cwd: string;
  // all inputs provided upfront — no prompting
}

export interface <Name>Result {
  // structured return data
}

export async function <name>Action(opts: <Name>Opts): Promise<<Name>Result> {
  const config = await readConfig(opts.cwd);
  if (!config) throw new Error("No kitn.json found. Run `kitn init` first.");

  // Pure logic here — no @clack/prompts, no process.exit, no picocolors

  return { /* result */ };
}
```

Export from `packages/cli-core/src/index.ts`:

```ts
export * from "./commands/<name>.js";
```

## 2. Create CLI wrapper

Create `packages/cli/src/commands/<name>.ts`:

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { <name>Action } from "@kitnai/cli-core";

interface <Name>Options {
  // CLI-specific options (may include interactive flags)
}

export async function <name>Command(opts: <Name>Options) {
  p.intro(pc.bgCyan(pc.black(" kitn <name> ")));

  const cwd = process.cwd();

  // Prompt for missing inputs if needed
  // ...

  const result = await <name>Action({ cwd, /* ... */ });

  // Format and display result
  p.log.success("Done");
  p.outro("Finished");
}
```

## 3. Register in index.ts

Edit `packages/cli/src/index.ts`:

```ts
program
  .command("<name>")
  .description("Description of the command")
  .argument("[arg]", "optional argument description")
  .option("-f, --flag", "flag description")
  .action(async (arg: string, opts) => {
    const { <name>Command } = await import("./commands/<name>.js");
    await <name>Command(arg, opts);
  });
```

## 4. Add MCP tool (if applicable)

Create `packages/mcp-server/src/tools/<name>.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { <name>Action } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function register<Name>Tool(server: McpServer) {
  registerTool(server, "kitn_<name>", "Description", {
    cwd: z.string().describe("Project working directory"),
  }, async ({ cwd }) => {
    try {
      const result = await <name>Action({ cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });
}
```

Register in `packages/mcp-server/src/server.ts`.

## 5. Verify

```bash
bun run build:cli                      # builds cli-core + cli
bun run build:mcp                      # builds cli-core + mcp-server
bun run test:cli                       # CLI tests
bun run test:cli-core                  # cli-core tests
bun run typecheck                      # all packages
```

## Reference files

- Core logic: `packages/cli-core/src/commands/list.ts` (simple), `packages/cli-core/src/commands/add.ts` (complex)
- CLI wrapper: `packages/cli/src/commands/list.ts` (simple), `packages/cli/src/commands/add.ts` (complex)
- MCP tool: `packages/mcp-server/src/tools/project.ts` (simple), `packages/mcp-server/src/tools/add.ts` (complex)
- Config: `packages/cli-core/src/config/io.ts`
- Barrel: `packages/cli-core/src/index.ts`
