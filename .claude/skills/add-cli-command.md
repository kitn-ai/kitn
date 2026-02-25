---
name: add-cli-command
description: Add a new CLI command to @kitnai/cli following the established pattern
---

# Add a CLI Command

Follow these steps to add a new command to `@kitnai/cli`.

## 1. Create command file

Create `packages/cli/src/commands/<name>.ts`:

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig } from "../utils/config.js";

interface <Name>Options {
  // command-specific options
}

export async function <name>Command(opts: <Name>Options) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const s = p.spinner();
  s.start("Working...");

  // Command logic here

  s.stop("Done");
  p.log.message(pc.dim("  Additional info"));
}
```

### Key patterns

- Use `@clack/prompts` for all user interaction (`p.intro`, `p.log`, `p.spinner`, `p.outro`)
- Use `picocolors` for color formatting (`pc.bold`, `pc.dim`, `pc.green`, `pc.red`, `pc.yellow`)
- Read project config with `readConfig(cwd)` from `../utils/config.js`
- Exit with `process.exit(1)` on unrecoverable errors

## 2. Register in index.ts

Edit `packages/cli/src/index.ts` and add a new command block:

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

Use dynamic `import()` — this keeps startup fast since commander only loads the command that runs.

## 3. Add tests

Create `packages/cli/test/<name>.test.ts` using `bun:test`.

## 4. Verify

```bash
bun run --cwd packages/cli typecheck
bun run --cwd packages/cli test
bun run --cwd packages/cli build
```

The CLI builds with `tsup` — verify the build succeeds since it bundles differently than tsc.

## Reference files

- Command registration: `packages/cli/src/index.ts`
- Simple command: `packages/cli/src/commands/list.ts`
- Complex command: `packages/cli/src/commands/add.ts`
- Config utility: `packages/cli/src/utils/config.ts`
