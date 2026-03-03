# `kitn new` — Project Scaffolding Command

## Summary

A new `kitn new [name]` CLI command and `kitn_new` MCP tool that scaffold a complete kitn project from a built-in template. The Hono-OpenAPI template (currently in the separate `kitn-ai/hono` repo) moves into `templates/hono/` in the monorepo. The separate repo is retired.

The AI agent (Claude Code via MCP) handles the natural language flow by chaining `kitn_new` with existing tools (`kitn_add`, `kitn_create`, `kitn_help`, `kitn_link`).

## Decisions

- **One template for now**: `templates/hono/` — always includes zod-openapi + Scalar. Called "Hono" to the user, not "Hono-OpenAPI".
- **No separate GitHub repo**: `kitn new` is the only scaffolding entry point. The `kitn-ai/hono` repo is retired.
- **No audit step**: The AI agent verifies as it goes using existing tools. A `kitn doctor` command can be added later.
- **MCP uses tool chaining**: No mega-tool. `kitn_new` scaffolds the project; existing tools handle everything after.
- **Task planning is the agent's job**: Claude Code breaks complex requests into steps using its own capabilities.

## Template Structure

`templates/hono/` contains these files, copied verbatim (with `{{name}}` placeholder replaced in `package.json`):

```
templates/hono/
  package.json          # name: "{{name}}", deps: hono, @hono/zod-openapi, ai, zod, etc.
  tsconfig.json         # ES2022, bundler resolution, bun-types
  .env.example          # PORT, OPENROUTER_API_KEY, DEFAULT_MODEL
  .gitignore            # node_modules, dist, .env, *.log
  src/
    index.ts            # Entry point — creates app, prints banner, exports fetch
    app.ts              # OpenAPIHono app — middleware, routes, docs, error handling
    env.ts              # t3-env validation — PORT, NODE_ENV, OPENROUTER_API_KEY, DEFAULT_MODEL
    ai.ts               # Stub router (replaced after kitn init)
    routes/
      hello.ts          # Example GET /hello/:name route
      check.ts          # POST /check — AI connectivity test
    schemas/
      common.ts         # Shared Zod schemas (HealthCheck, Error)
```

## CLI Command: `kitn new`

### Usage

```
kitn new [name] [--framework hono|elysia] [--runtime bun|node|deno] [--yes]
```

### Interactive Flow

1. **Project name** — prompt if not provided as argument
2. **Framework** — prompt with options:
   - Hono (recommended)
   - Elysia (experimental)
3. **Runtime** — prompt with options: Bun (recommended), Node.js, Deno
4. **Copy template** — copy `templates/<framework>/` to `./<name>/`
5. **Replace placeholders** — substitute `{{name}}` in `package.json`
6. **Run `kitn init`** — creates kitn.json, patches tsconfig, scaffolds `src/ai/` (barrel + plugin)
7. **Install core + routes** — `addComponents(["core", routesAdapter])`
8. **Generate rules** — creates `AGENTS.md` so AI agents know kitn patterns
9. **Print next steps**:
   ```
   cd <name>
   bun install
   cp .env.example .env  # add your OPENROUTER_API_KEY
   bun dev
   ```

### `--yes` Flag

Skips all prompts, uses defaults: framework=hono, runtime=bun, name required as argument.

## MCP Tool: `kitn_new`

### Schema

```ts
kitn_new({
  name: z.string().describe("Project name"),
  path: z.string().describe("Parent directory to create the project in"),
  framework: z.string().optional().describe("Framework: hono (default), elysia (experimental)"),
  runtime: z.string().optional().describe("Runtime: bun (default), node, deno"),
})
```

### Behavior

1. Copy template to `<path>/<name>/`
2. Replace placeholders
3. Run `initProject()` inside the new directory
4. Run `addComponents(["core", routesAdapter])`
5. Generate rules files
6. Return: `{ projectPath, framework, runtime, npmDeps, nextSteps }`

### Natural Language Flow (MCP)

User: "Create a new kitn service called weather-api with a weather agent and a custom analytics agent"

Claude Code chains:
1. `kitn_new({ name: "weather-api", path: "/Users/home/projects" })` — scaffold
2. `kitn_registry_search("weather")` — found `weather-agent`
3. `kitn_add(["weather-agent"])` — install from registry
4. `kitn_registry_search("analytics")` — not found
5. `kitn_create({ type: "agent", name: "analytics-agent" })` — scaffold the kitn way
6. `kitn_help({ topic: "agent" })` — read kitn agent patterns
7. Write implementation following kitn conventions
8. `kitn_link({ toolName: "...", agentName: "analytics-agent" })` — wire up

## cli-core Layer

`packages/cli-core/src/commands/new.ts`:

```ts
export interface NewProjectOpts {
  name: string;
  targetDir: string;       // parent directory
  framework?: string;      // default: "hono"
  runtime?: string;        // default: "bun"
}

export interface NewProjectResult {
  projectPath: string;
  framework: string;
  runtime: string;
  filesCreated: string[];
  initResult: InitResult;
  addResult: { npmDeps: string[]; npmDevDeps: string[] };
}

export async function newProject(opts: NewProjectOpts): Promise<NewProjectResult>
```

Steps:
1. Validate framework is a known template
2. Check target directory doesn't already exist
3. Copy template files from resolved template path
4. Replace `{{name}}` placeholder in package.json
5. Call `initProject()` with detected framework + runtime
6. Call `addComponents(["core", routesAdapter])` with `overwrite: true`
7. Return structured result

### Template Resolution

Templates are co-located in the built package. At build time, the `templates/` directory is included in the `cli-core` package output. At runtime, `newProject` resolves the template path relative to its own `__dirname`.

## CLI Layer

`packages/cli/src/commands/new.ts`:

Thin UI wrapper:
1. Prompt for name if not provided
2. Prompt for framework (Hono recommended, Elysia experimental)
3. Prompt for runtime (Bun recommended)
4. Call `newProject()` from cli-core
5. Generate rules files
6. Print summary + next steps with `@clack/prompts`

Register in `packages/cli/src/index.ts` as `kitn new [name]`.

## MCP Layer

`packages/mcp-server/src/tools/new.ts`:

Standard register pattern. Calls `newProject()` from cli-core. Returns minimal JSON response with project path, framework, runtime, npm deps, and next steps.

Register in `packages/mcp-server/src/server.ts`.

## Files Summary

| File | Action |
|------|--------|
| `templates/hono/` | CREATE (copy from kitn-ai/hono repo) |
| `packages/cli-core/src/commands/new.ts` | CREATE |
| `packages/cli-core/src/index.ts` | MODIFY (add export) |
| `packages/cli/src/commands/new.ts` | CREATE |
| `packages/cli/src/index.ts` | MODIFY (register command) |
| `packages/mcp-server/src/tools/new.ts` | CREATE |
| `packages/mcp-server/src/server.ts` | MODIFY (register tool) |
