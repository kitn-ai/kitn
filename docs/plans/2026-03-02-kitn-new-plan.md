# `kitn new` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `kitn new` CLI command and `kitn_new` MCP tool that scaffold a complete kitn project from a built-in Hono template.

**Architecture:** Template files live in `templates/hono/` in the monorepo. `cli-core` has the pure logic (`newProject()`) that copies the template, runs `initProject()`, and installs core + routes. CLI wraps with prompts, MCP wraps with Zod schemas.

**Tech Stack:** TypeScript, tsup, Commander.js, @clack/prompts, @modelcontextprotocol/sdk, Zod

---

### Task 1: Create Template Directory

**Files:**
- Create: `templates/hono/package.json`
- Create: `templates/hono/tsconfig.json`
- Create: `templates/hono/.env.example`
- Create: `templates/hono/.gitignore`
- Create: `templates/hono/src/index.ts`
- Create: `templates/hono/src/app.ts`
- Create: `templates/hono/src/env.ts`
- Create: `templates/hono/src/ai.ts`
- Create: `templates/hono/src/routes/hello.ts`
- Create: `templates/hono/src/routes/check.ts`
- Create: `templates/hono/src/schemas/common.ts`

**Step 1: Create all template files**

These are copied from the `kitn-ai/hono` GitHub repo. The `package.json` uses `"{{name}}"` as the project name placeholder and `"{{version}}"` for version:

`templates/hono/package.json`:
```json
{
  "name": "{{name}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/zod-openapi": "^1.2.2",
    "@openrouter/ai-sdk-provider": "^2.2.3",
    "@scalar/hono-api-reference": "^0.9.46",
    "@t3-oss/env-core": "^0.13.8",
    "ai": "^6.0.104",
    "hono": "^4.12.3",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.2"
  }
}
```

`templates/hono/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`templates/hono/.env.example`:
```
PORT=4000
NODE_ENV=development

# Get your API key at https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Default model for AI requests (see https://openrouter.ai/models)
DEFAULT_MODEL=openai/gpt-4o-mini
```

`templates/hono/.gitignore`:
```
node_modules/
dist/
.env
*.log
```

`templates/hono/src/index.ts`:
```ts
import { env } from "./env.js";
import { createApp } from "./app.js";

const app = createApp(env);

console.log("");
console.log("\u2550".repeat(59));
console.log("  {{name}}");
console.log("\u2550".repeat(59));
console.log(`  Server:      http://localhost:${env.PORT}`);
console.log(`  Docs:        http://localhost:${env.PORT}/docs`);
console.log(`  OpenAPI:     http://localhost:${env.PORT}/openapi`);
console.log(`  AI API:      http://localhost:${env.PORT}/api`);
console.log("\u2550".repeat(59));
console.log("");

export default {
  port: env.PORT,
  fetch: app.fetch,
};
```

`templates/hono/src/app.ts`:
```ts
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";
import { HealthCheckResponseSchema } from "./schemas/common.js";
import { registerHelloRoute } from "./routes/hello.js";
import { registerCheckRoute } from "./routes/check.js";
import { ai } from "./ai.js";
import type { Env } from "./env.js";

export function createApp(env: Env) {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const s = c.res.status;
    const icon = s < 300 ? "\u2713" : s < 400 ? "\u25CB" : "\u2717";
    console.log(`${icon} ${c.req.method} ${c.req.path} - ${s} (${ms}ms)`);
  });

  app.use("*", cors());

  // Routes
  const healthRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Health"],
    summary: "Health check",
    description: "Check if the service is running",
    responses: {
      200: {
        description: "Service is healthy",
        content: {
          "application/json": { schema: HealthCheckResponseSchema },
        },
      },
    },
  });

  app.openapi(healthRoute, (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  registerHelloRoute(app);
  registerCheckRoute(app, env);

  // kitn AI routes (stub until `kitn init` is run)
  app.route("/api", ai.router);

  // API Documentation
  app.get("/openapi", (c) => {
    return c.json(
      app.getOpenAPIDocument({
        openapi: "3.1.0",
        info: {
          version: "1.0.0",
          title: "{{name}} API",
          description: "API documentation",
        },
        servers: [
          { url: `http://localhost:${env.PORT}`, description: "Development" },
        ],
      }),
    );
  });

  app.get(
    "/docs",
    Scalar({
      theme: "purple",
      pageTitle: "{{name}} API",
      url: "/openapi",
    }),
  );

  // Error handlers
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("API Error:", err);
    return c.json(
      {
        error: err.message || "Internal Server Error",
        ...(env.NODE_ENV === "development" && { stack: err.stack }),
      },
      500,
    );
  });

  return app;
}
```

`templates/hono/src/env.ts`:
```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    OPENROUTER_API_KEY: z
      .string()
      .min(1, "OPENROUTER_API_KEY is required — get one at https://openrouter.ai/keys"),
    DEFAULT_MODEL: z.string().default("openai/gpt-4o-mini"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
```

`templates/hono/src/ai.ts`:
```ts
// Stub router — replaced when you run: kitn init
// After init, replace this file with:
//   export { ai } from "@kitn/plugin";
import { OpenAPIHono } from "@hono/zod-openapi";

export const ai = { router: new OpenAPIHono() };
```

`templates/hono/src/routes/hello.ts`:
```ts
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

const HelloResponseSchema = z.object({
  message: z.string().openapi({ example: "Hello, World!" }),
});

const route = createRoute({
  method: "get",
  path: "/hello/{name}",
  tags: ["Example"],
  summary: "Say hello",
  description: "Returns a greeting for the given name",
  request: {
    params: z.object({
      name: z.string().min(1).openapi({ example: "World" }),
    }),
  },
  responses: {
    200: {
      description: "A greeting",
      content: {
        "application/json": { schema: HelloResponseSchema },
      },
    },
  },
});

export function registerHelloRoute(app: OpenAPIHono) {
  app.openapi(route, (c) => {
    const { name } = c.req.valid("param");
    return c.json({ message: `Hello, ${name}!` });
  });
}
```

`templates/hono/src/routes/check.ts`:
```ts
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { generateText } from "ai";
import { openrouter } from "@openrouter/ai-sdk-provider";
import type { Env } from "../env.js";

const CheckResponseSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
  model: z.string().openapi({ example: "openai/gpt-4o-mini" }),
  response: z
    .string()
    .optional()
    .openapi({ example: "Hello! I'm working correctly." }),
  error: z
    .string()
    .optional()
    .openapi({ example: "Authentication failed" }),
});

const route = createRoute({
  method: "post",
  path: "/check",
  tags: ["Health"],
  summary: "Test AI connection",
  description:
    "Sends a simple prompt to the configured AI model and returns the response. Use this to verify your OpenRouter API key and model are working.",
  responses: {
    200: {
      description: "AI connection check result",
      content: {
        "application/json": { schema: CheckResponseSchema },
      },
    },
  },
});

export function registerCheckRoute(app: OpenAPIHono, env: Env) {
  app.openapi(route, async (c) => {
    const model = env.DEFAULT_MODEL;
    try {
      const { text } = await generateText({
        model: openrouter(model),
        prompt: "Say hello in one short sentence.",
        maxOutputTokens: 50,
      });

      return c.json({ ok: true, model, response: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ ok: false, model, error: message });
    }
  });
}
```

`templates/hono/src/schemas/common.ts`:
```ts
import { z } from "@hono/zod-openapi";

export const HealthCheckResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2025-01-07T12:00:00.000Z" }),
});

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: "An error occurred" }),
  details: z
    .string()
    .optional()
    .openapi({ example: "Detailed error information" }),
});
```

**Step 2: Verify the template directory exists and has all files**

Run: `find templates/hono -type f | sort`

Expected:
```
templates/hono/.env.example
templates/hono/.gitignore
templates/hono/package.json
templates/hono/src/ai.ts
templates/hono/src/app.ts
templates/hono/src/env.ts
templates/hono/src/index.ts
templates/hono/src/routes/check.ts
templates/hono/src/routes/hello.ts
templates/hono/src/schemas/common.ts
templates/hono/tsconfig.json
```

**Step 3: Commit**

```bash
git add templates/hono/
git commit -m "feat: add hono project template for kitn new"
```

---

### Task 2: Create cli-core `newProject()` Function

**Files:**
- Create: `packages/cli-core/src/commands/new.ts`
- Modify: `packages/cli-core/src/index.ts` (add export)

**Step 1: Write the implementation**

Create `packages/cli-core/src/commands/new.ts`:

```ts
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { initProject, type InitResult } from "./init.js";
import { addComponents } from "./add.js";
import { resolveRoutesAlias } from "../types/config.js";
import { generateRulesFiles } from "./rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_TEMPLATES = ["hono"] as const;
export type Template = (typeof VALID_TEMPLATES)[number];

/** Maps user-facing template name to the framework value used by initProject */
const TEMPLATE_TO_FRAMEWORK: Record<string, string> = {
  hono: "hono-openapi",
};

export interface NewProjectOpts {
  name: string;
  targetDir: string;
  framework?: string;  // default: "hono"
  runtime?: string;    // default: "bun"
}

export interface NewProjectResult {
  projectPath: string;
  framework: string;
  runtime: string;
  filesCreated: string[];
  npmDeps: string[];
  npmDevDeps: string[];
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a template directory.
 *
 * In dev (bun workspace): templates/ is at repo root.
 * In dist (npm): templates/ is copied alongside dist/.
 *
 * We walk up from __dirname until we find a `templates/<name>` directory.
 */
function resolveTemplatePath(templateName: string): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up looking for templates/<name>/package.json
  let dir = join(thisFile, "..");
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "templates", templateName, "package.json");
    try {
      // Synchronous check — this runs once at scaffold time, not hot path
      // We use a simple approach: build the path and let the caller validate
      return join(dir, "templates", templateName);
    } catch {
      // keep walking
    }
    dir = join(dir, "..");
  }
  // Fallback: relative to repo root
  return join(dir, "templates", templateName);
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory, applying placeholder replacements to file contents.
 */
async function copyDir(
  src: string,
  dest: string,
  replacements: Record<string, string>,
): Promise<string[]> {
  const created: string[] = [];
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = await copyDir(srcPath, destPath, replacements);
      created.push(...sub);
    } else {
      let content = await readFile(srcPath, "utf-8");
      for (const [placeholder, value] of Object.entries(replacements)) {
        content = content.replaceAll(placeholder, value);
      }
      await writeFile(destPath, content);
      created.push(destPath);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Main: newProject
// ---------------------------------------------------------------------------

export async function newProject(opts: NewProjectOpts): Promise<NewProjectResult> {
  const { name, targetDir, framework: templateName = "hono", runtime = "bun" } = opts;

  // Validate template
  if (!VALID_TEMPLATES.includes(templateName as Template)) {
    throw new Error(
      `Unknown template: "${templateName}". Available: ${VALID_TEMPLATES.join(", ")}`,
    );
  }

  const projectPath = join(targetDir, name);

  // Check target doesn't exist
  try {
    await stat(projectPath);
    throw new Error(`Directory "${name}" already exists in ${targetDir}`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    // ENOENT means it doesn't exist — good
  }

  // Copy template
  const templatePath = resolveTemplatePath(templateName);
  const replacements = { "{{name}}": name };
  const filesCreated = await copyDir(templatePath, projectPath, replacements);

  // Map template name to framework value for initProject
  const framework = TEMPLATE_TO_FRAMEWORK[templateName] ?? templateName;

  // Run kitn init inside the new project
  const initResult = await initProject({
    cwd: projectPath,
    runtime,
    framework,
  });

  // Install core + routes adapter
  const routesAdapter = resolveRoutesAlias(initResult.config);
  const addResult = await addComponents({
    components: ["core", routesAdapter],
    cwd: projectPath,
    overwrite: true,
  });

  // Generate rules files (all tools, non-interactive)
  try {
    await generateRulesFiles(projectPath, initResult.config);
  } catch {
    // Non-fatal — rules are a nice-to-have
  }

  return {
    projectPath,
    framework: templateName,
    runtime,
    filesCreated: filesCreated.map((f) => relative(projectPath, f)),
    npmDeps: addResult.npmDeps,
    npmDevDeps: addResult.npmDevDeps,
  };
}
```

**Step 2: Add export to cli-core index**

In `packages/cli-core/src/index.ts`, add after the `init.js` export:

```ts
export * from "./commands/new.js";
```

**Step 3: Run typecheck**

Run: `bun run --cwd packages/cli-core typecheck`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/new.ts packages/cli-core/src/index.ts
git commit -m "feat(cli-core): add newProject() for project scaffolding"
```

---

### Task 3: Create CLI `kitn new` Command

**Files:**
- Create: `packages/cli/src/commands/new.ts`
- Modify: `packages/cli/src/index.ts` (register command)

**Step 1: Create the CLI command**

Create `packages/cli/src/commands/new.ts`:

```ts
import * as p from "@clack/prompts";
import pc from "picocolors";
import { newProject, VALID_TEMPLATES } from "@kitnai/cli-core";

interface NewOptions {
  framework?: string;
  runtime?: string;
  yes?: boolean;
}

export async function newCommand(nameArg?: string, opts: NewOptions = {}) {
  p.intro(pc.bgCyan(pc.black(" kitn new ")));

  const targetDir = process.cwd();

  // --- Resolve name ---
  let name: string;
  if (nameArg) {
    name = nameArg;
  } else if (opts.yes) {
    p.log.error("Project name is required with --yes flag.");
    process.exit(1);
  } else {
    const input = await p.text({
      message: "What should your project be called?",
      placeholder: "my-app",
      validate: (v) => {
        if (!v.trim()) return "Project name is required";
        if (/[^a-z0-9-_]/.test(v)) return "Use lowercase letters, numbers, hyphens, underscores only";
      },
    });
    if (p.isCancel(input)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    name = input as string;
  }

  // --- Resolve framework (template) ---
  let framework: string;
  if (opts.framework) {
    if (!VALID_TEMPLATES.includes(opts.framework as any)) {
      p.log.error(`Invalid framework: ${opts.framework}. Available: ${VALID_TEMPLATES.join(", ")}`);
      process.exit(1);
    }
    framework = opts.framework;
  } else if (opts.yes) {
    framework = "hono";
  } else {
    const selected = await p.select({
      message: "Which framework?",
      options: [
        { value: "hono", label: "Hono", hint: "recommended — with OpenAPI + Scalar docs" },
        // { value: "elysia", label: "Elysia", hint: "experimental" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    framework = selected as string;
  }

  // --- Resolve runtime ---
  let runtime: string;
  if (opts.runtime) {
    if (!["bun", "node", "deno"].includes(opts.runtime)) {
      p.log.error(`Invalid runtime: ${opts.runtime}. Must be bun, node, or deno.`);
      process.exit(1);
    }
    runtime = opts.runtime;
  } else if (opts.yes) {
    runtime = "bun";
  } else {
    const selected = await p.select({
      message: "Which runtime?",
      options: [
        { value: "bun", label: "Bun", hint: "recommended" },
        { value: "node", label: "Node.js" },
        { value: "deno", label: "Deno" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    runtime = selected as string;
  }

  // --- Scaffold ---
  const s = p.spinner();
  s.start(`Creating ${pc.bold(name)}`);

  let result;
  try {
    result = await newProject({ name, targetDir, framework, runtime });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Created ${pc.bold(name)}`);

  // --- Summary ---
  p.log.success(`${pc.bold(result.filesCreated.length)} files created`);

  if (result.npmDeps.length > 0) {
    p.log.info(`npm dependencies to install: ${result.npmDeps.map((d) => pc.cyan(d)).join(", ")}`);
  }

  const runCmd = runtime === "bun" ? "bun" : "npm run";
  const installCmd = runtime === "bun" ? "bun install" : "npm install";

  p.note(
    [
      `cd ${name}`,
      installCmd,
      `cp .env.example .env  ${pc.dim("# add your OPENROUTER_API_KEY")}`,
      `${runCmd} dev`,
    ].join("\n"),
    "Next steps:",
  );

  p.log.message(
    [
      pc.bold("Add your first agent:"),
      `  ${pc.cyan("kitn add weather-agent")}`,
      "",
      pc.bold("Browse all components:"),
      `  ${pc.cyan("kitn list")}`,
    ].join("\n"),
  );

  p.outro("Done!");
}
```

**Step 2: Register the command in `packages/cli/src/index.ts`**

Add after the `init` command registration (after line 24):

```ts
program
  .command("new")
  .description("Create a new kitn project from a starter template")
  .argument("[name]", "project name")
  .option("-f, --framework <framework>", "template to use (hono)")
  .option("-r, --runtime <runtime>", "runtime (bun, node, deno)")
  .option("-y, --yes", "accept all defaults without prompting")
  .action(async (name: string | undefined, opts) => {
    const { newCommand } = await import("./commands/new.js");
    await newCommand(name, opts);
  });
```

**Step 3: Build and typecheck**

Run: `bun run build:cli`
Expected: successful build with no errors

**Step 4: Commit**

```bash
git add packages/cli/src/commands/new.ts packages/cli/src/index.ts
git commit -m "feat(cli): add kitn new command"
```

---

### Task 4: Create MCP `kitn_new` Tool

**Files:**
- Create: `packages/mcp-server/src/tools/new.ts`
- Modify: `packages/mcp-server/src/server.ts`

**Step 1: Create the MCP tool**

Create `packages/mcp-server/src/tools/new.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newProject } from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

export function registerNewTool(server: McpServer) {
  registerTool<{
    name: string;
    path: string;
    framework?: string;
    runtime?: string;
  }>(
    server,
    "kitn_new",
    {
      description:
        "Create a new kitn project from a starter template. Scaffolds project files, initializes kitn, and installs core + routes adapter.",
      inputSchema: {
        name: z.string().describe("Project name (e.g. 'my-api')"),
        path: z
          .string()
          .describe("Parent directory to create the project in"),
        framework: z
          .string()
          .optional()
          .describe("Template: hono (default)"),
        runtime: z
          .string()
          .optional()
          .describe("Runtime: bun (default), node, deno"),
      },
    },
    async ({ name, path, framework, runtime }) => {
      try {
        const result = await newProject({
          name,
          targetDir: path,
          framework,
          runtime,
        });

        const installCmd = result.runtime === "bun" ? "bun install" : "npm install";
        const runCmd = result.runtime === "bun" ? "bun dev" : "npm run dev";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  projectPath: result.projectPath,
                  framework: result.framework,
                  runtime: result.runtime,
                  filesCreated: result.filesCreated.length,
                  npmDeps: result.npmDeps,
                  nextSteps: [
                    `cd ${name}`,
                    installCmd,
                    "cp .env.example .env  # add OPENROUTER_API_KEY",
                    runCmd,
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Register in server.ts**

In `packages/mcp-server/src/server.ts`:

Add import:
```ts
import { registerNewTool } from "./tools/new.js";
```

Add registration after `registerInitTool(server);`:
```ts
registerNewTool(server);
```

**Step 3: Build and verify**

Run: `bun run build:mcp`
Expected: successful build

**Step 4: Commit**

```bash
git add packages/mcp-server/src/tools/new.ts packages/mcp-server/src/server.ts
git commit -m "feat(mcp): add kitn_new tool for project scaffolding"
```

---

### Task 5: Fix Template Resolution for Builds

The template directory needs to be accessible both in dev (bun workspace, source) and in dist (after tsup build). Since tsup doesn't copy static files, we need to handle this.

**Files:**
- Modify: `packages/cli-core/src/commands/new.ts` (refine `resolveTemplatePath`)
- Modify: `packages/cli-core/package.json` (add copy script)

**Step 1: Update package.json to copy templates during build**

In `packages/cli-core/package.json`, update the `build` script:

```json
"build": "tsup && cp -r ../../templates dist/templates"
```

Also update `files` to include templates:

```json
"files": ["dist"]
```

(Templates are inside `dist/templates` so they're already covered.)

**Step 2: Refine resolveTemplatePath**

Replace the `resolveTemplatePath` function in `packages/cli-core/src/commands/new.ts`:

```ts
/**
 * Resolve the absolute path to a template directory.
 *
 * Strategy: walk up from this file's directory until we find a directory
 * containing `templates/<name>/package.json`. Works in:
 * - Dev: bun runs from source, walks up to repo root
 * - Dist: templates are copied to dist/templates/ during build
 */
async function resolveTemplatePath(templateName: string): Promise<string> {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = join(thisFile, "..");

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "templates", templateName);
    try {
      const s = await stat(join(candidate, "package.json"));
      if (s.isFile()) return candidate;
    } catch {
      // not found, keep walking
    }
    const parent = join(dir, "..");
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  throw new Error(
    `Could not find template "${templateName}". Looked for templates/${templateName}/package.json`,
  );
}
```

**Step 3: Build and verify template is included**

Run: `bun run build:core && ls packages/cli-core/dist/templates/hono/`
Expected: template files are present in `dist/templates/hono/`

**Step 4: Commit**

```bash
git add packages/cli-core/src/commands/new.ts packages/cli-core/package.json
git commit -m "fix(cli-core): ensure templates are included in dist builds"
```

---

### Task 6: Manual Testing

**Step 1: Build everything**

Run: `bun run build:cli`
Expected: successful build of cli-core + cli

**Step 2: Test CLI `kitn new` interactively**

Run from a test directory:
```bash
cd test-projects
bun run ../packages/cli/dist/index.js new test-app
```

Expected flow:
1. Prompts for framework (select Hono)
2. Prompts for runtime (select Bun)
3. Scaffolds project
4. Prints summary with next steps

Verify:
```bash
ls test-projects/test-app/
cat test-projects/test-app/package.json   # name should be "test-app"
cat test-projects/test-app/kitn.json      # should exist with hono-openapi framework
ls test-projects/test-app/src/ai/         # should have index.ts + plugin.ts
```

**Step 3: Test `--yes` flag**

```bash
cd test-projects
bun run ../packages/cli/dist/index.js new test-app-2 --yes
```

Expected: no prompts, uses defaults (hono, bun), creates project

**Step 4: Test error on existing directory**

```bash
bun run ../packages/cli/dist/index.js new test-app --yes
```

Expected: error message "Directory test-app already exists"

**Step 5: Clean up test projects**

```bash
rm -rf test-projects/test-app test-projects/test-app-2
```

**Step 6: Test MCP tool**

Run: `bun run build:mcp`

Use the MCP inspector to verify `kitn_new` is registered:
```bash
bun run mcp:inspect
```

Call `kitn_new` with `{ name: "mcp-test", path: "/tmp" }` and verify it creates the project.

Clean up: `rm -rf /tmp/mcp-test`

---

### Task 7: Final Build and Verify

**Step 1: Full build**

Run: `bun run build`
Expected: all packages build successfully

**Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no type errors

**Step 3: Run existing tests**

Run: `bun run test:cli-core && bun run test:cli`
Expected: all existing tests pass (no regressions)

**Step 4: Commit any remaining changes**

If any fixes were needed during testing, commit them.
