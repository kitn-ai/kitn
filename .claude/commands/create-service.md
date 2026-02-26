# Create New Service

Create a new microservice following established patterns. This command supports multiple runtimes, deployment targets, and project structures.

---

## Step 0: Determine Stack Configuration

Before generating anything, determine the user's stack by **inferring from context**, then **confirming**.

### Infer

Check the project for these signals:

| Signal | Indicates |
|--------|-----------|
| `bun.lockb` exists | **Runtime: Bun** |
| `package-lock.json` exists | **Runtime: Node (npm)** |
| `pnpm-lock.yaml` exists | **Runtime: Node (pnpm)** |
| Root `package.json` has `"workspaces"` | **Structure: Monorepo** |
| No workspaces config | **Structure: Standalone** |
| `wrangler.toml` exists anywhere | Cloudflare Workers likely desired |
| `vercel.json` exists | Vercel Edge likely desired |

### Confirm

Present your inference to the user and ask them to confirm or adjust. Ask for:

1. **RUNTIME** — `bun` or `node` (npm/pnpm)
2. **DEPLOYMENT** — one or more of: `standalone`, `cloudflare`, `edge`
3. **STRUCTURE** — `monorepo` or `standalone`

Example: _"I see `bun.lockb` and workspaces in the root `package.json`, so I'm assuming **Bun + Monorepo**. Which deployment target(s) do you want? (Standalone server, Cloudflare Workers, Edge/Vercel/Deno)"_

### Carry Forward

Use these three variables throughout the rest of this guide. Only generate files and dependencies relevant to the confirmed configuration.

---

## Step 1: Create Directory Structure

### If STRUCTURE = monorepo

```bash
mkdir -p packages/service/[service-name]/{src,tests}
cd packages/service/[service-name]
```

### If STRUCTURE = standalone

```bash
mkdir -p [service-name]/{src,tests}
cd [service-name]
```

If DEPLOYMENT includes `cloudflare`, also create `scripts/`:

```bash
mkdir -p scripts
```

---

## Step 2: Create package.json

### If RUNTIME = bun

```json
{
  "name": "[package-name]",
  "version": "1.0.0",
  "description": "[Service description]",
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hono/zod-openapi": "^1.1.4",
    "@scalar/hono-api-reference": "^0.9.23",
    "@t3-oss/env-core": "^0.13.8",
    "hono": "^4.6.14",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

**Notes:**
- No `dotenv` — Bun auto-loads `.env` files
- No `tsx` — Bun runs TypeScript natively
- `@types/bun` for Bun-specific APIs (`Bun.serve`, `Bun.env`, etc.)

### If RUNTIME = node (npm or pnpm)

```json
{
  "name": "[package-name]",
  "version": "1.0.0",
  "description": "[Service description]",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "start": "NODE_ENV=production tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hono/zod-openapi": "^1.1.4",
    "@hono/node-server": "^1.13.8",
    "@scalar/hono-api-reference": "^0.9.23",
    "@t3-oss/env-core": "^0.13.8",
    "dotenv": "^16.4.7",
    "hono": "^4.6.14",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.20.6",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

**Notes:**
- `dotenv` is required — Node.js does not auto-load `.env` files
- `tsx` for TypeScript execution in dev
- `@hono/node-server` for the HTTP adapter

### Additional dependencies by DEPLOYMENT

**If DEPLOYMENT includes `cloudflare`**, add to the base package.json:

```json
{
  "scripts": {
    "workers:dev": "wrangler dev",
    "workers:deploy": "wrangler deploy",
    "workers:deploy:prod": "wrangler deploy --env production",
    "workers:tail": "wrangler tail",
    "workers:secrets": "bash scripts/setup-secrets.sh"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20251014.0",
    "wrangler": "^4.45.4"
  }
}
```

**If DEPLOYMENT includes `edge` (Vercel)**, add:

```json
{
  "scripts": {
    "vercel:dev": "vercel dev",
    "vercel:deploy": "vercel deploy"
  },
  "devDependencies": {
    "vercel": "latest"
  }
}
```

### Package naming

- **STRUCTURE = monorepo**: Use workspace scope, e.g. `@service/[service-name]` or `@<org>/[service-name]`
- **STRUCTURE = standalone**: Use plain name, e.g. `[service-name]`

---

## Step 3: Create TypeScript Config (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**If RUNTIME = bun**, you may also add:

```json
{
  "compilerOptions": {
    "types": ["bun-types"]
  }
}
```

**If STRUCTURE = monorepo** and a shared tsconfig exists at the root, extend it:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

---

## Step 4: Create Environment Config (src/env.ts)

**`@t3-oss/env-core` is ALWAYS required** regardless of runtime. It provides:
- Type-safe environment variables with full IDE autocomplete
- Runtime validation on startup (fail fast on misconfiguration)
- Clear error messages for missing/invalid variables
- Default values and transformations
- Self-documenting configuration

The ONLY difference between runtimes is how `.env` files get loaded.

### If RUNTIME = bun

Bun auto-loads `.env` files. No `dotenv` needed.

```typescript
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(5000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Required variables (app won't start without these)
    API_KEY: z.string().min(1, "API_KEY is required"),

    // Optional variables
    WEBHOOK_URL: z.string().url().optional(),

    // Numeric with coercion
    MAX_CONNECTIONS: z.coerce.number().default(100),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
```

### If RUNTIME = node

Node.js needs `dotenv` to load `.env` files before validation runs.

```typescript
import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(5000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Required variables (app won't start without these)
    API_KEY: z.string().min(1, "API_KEY is required"),

    // Optional variables
    WEBHOOK_URL: z.string().url().optional(),

    // Numeric with coercion
    MAX_CONNECTIONS: z.coerce.number().default(100),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
```

**For monorepo Node.js projects** where `env.ts` is nested deep, you may need to resolve the `.env` path explicitly:

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

// ... createEnv() as above
```

### Common Env Patterns

```typescript
// URL validation
BASE_URL: z.string().url()

// Enum validation
ENVIRONMENT: z.enum(["dev", "staging", "prod"])

// Number coercion from string
PORT: z.coerce.number()
MAX_SIZE: z.coerce.number().default(100)

// Boolean-like from string
ENABLED: z.string().transform(val => val === "true").default("false")

// Optional with default
TIMEOUT: z.coerce.number().default(5000)

// Required with descriptive error
API_KEY: z.string().min(32, "API key must be at least 32 characters")

// Complex validation
EMAIL: z.string().email()
HTTPS_URL: z.string().url().refine(url => url.startsWith("https://"))
```

---

## Step 5: Create Schemas (src/schemas.ts)

This is the same for all configurations.

```typescript
import { z } from "@hono/zod-openapi";

// Health check
export const HealthCheckResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2025-01-07T12:00:00.000Z" }),
});

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: "An error occurred" }),
  details: z.string().optional().openapi({ example: "Detailed error information" }),
});

// Add service-specific schemas here
```

---

## Step 6: Create App Factory (src/app.ts)

This is the same for all configurations. The app factory is pure Hono — no runtime-specific code.

```typescript
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HealthCheckResponseSchema } from "./schemas.js";
import type { Env } from "./env.js";

export function createApp(env: Env) {
  const app = new OpenAPIHono();

  // ===================================================================
  // MIDDLEWARE
  // ===================================================================

  // Request logging
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const s = c.res.status;
    const icon = s < 300 ? "✓" : s < 400 ? "○" : "✗";
    console.log(`${icon} ${c.req.method} ${c.req.path} - ${s} (${ms}ms)`);
  });

  // CORS
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Access-Control-Allow-Origin", "*");
    c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  });

  // ===================================================================
  // ROUTES
  // ===================================================================

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

  // Add service routes here

  // ===================================================================
  // API DOCUMENTATION
  // ===================================================================

  app.get("/openapi", (c) => {
    return c.json(
      app.getOpenAPIDocument({
        openapi: "3.1.0",
        info: {
          version: "1.0.0",
          title: "[Service Name] API",
          description: "[Service description]",
        },
        servers: [
          { url: `http://localhost:${env.PORT}`, description: "Development" },
        ],
      })
    );
  });

  app.get(
    "/docs",
    Scalar({
      theme: "purple",
      pageTitle: "[Service Name] API",
      url: "/openapi",
    }) as any
  );

  // ===================================================================
  // ERROR HANDLERS
  // ===================================================================

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("API Error:", err);
    return c.json(
      {
        error: err.message || "Internal Server Error",
        ...(env.NODE_ENV === "development" && { stack: err.stack }),
      },
      500
    );
  });

  return app;
}
```

---

## Step 7: Create Entry Points

Generate ONLY the entry points that match the confirmed DEPLOYMENT targets.

### DEPLOYMENT = standalone (server)

#### If RUNTIME = bun — `src/index.ts`

```typescript
import { env } from "./env.js";
import { createApp } from "./app.js";

const app = createApp(env);

console.log("═══════════════════════════════════════════════════════════");
console.log("  [Service Name] v1.0.0");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Server:      http://localhost:${env.PORT}`);
console.log(`  Docs:        http://localhost:${env.PORT}/docs`);
console.log(`  OpenAPI:     http://localhost:${env.PORT}/openapi`);
console.log("═══════════════════════════════════════════════════════════");

export default {
  port: env.PORT,
  fetch: app.fetch,
};
```

**Note:** Bun uses `export default` with `port` and `fetch` for its native HTTP server. No adapter package needed.

#### If RUNTIME = node — `src/index.ts`

```typescript
import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { createApp } from "./app.js";

const app = createApp(env);

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  [Service Name] v1.0.0");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Server:      http://localhost:${env.PORT}`);
  console.log(`  Docs:        http://localhost:${env.PORT}/docs`);
  console.log(`  OpenAPI:     http://localhost:${env.PORT}/openapi`);
  console.log("═══════════════════════════════════════════════════════════");
});
```

### DEPLOYMENT = cloudflare — `src/worker.ts`

```typescript
import { createApp } from "./app.js";

export interface WorkerEnv {
  // Cloudflare Workers bindings (KV, Durable Objects, secrets, etc.)
  [key: string]: any;
}

export default {
  async fetch(request: Request, workerEnv: WorkerEnv): Promise<Response> {
    const app = createApp({
      PORT: 8787,
      NODE_ENV: "production",
      // Map Workers env bindings to your AppEnv shape
      API_KEY: workerEnv.API_KEY,
    });

    return app.fetch(request);
  },
};
```

**Also create:**

**`wrangler.toml`:**

```toml
name = "[service-name]"
main = "src/worker.ts"
compatibility_date = "2024-11-01"

[env.development]
name = "[service-name]-dev"

[env.production]
name = "[service-name]"
```

**`.dev.vars`:**

```env
# Cloudflare Workers local development secrets
# Copy values from .env
API_KEY=your-api-key-here
```

**`scripts/setup-secrets.sh`:**

```bash
#!/bin/bash
set -e

echo "Setting up Cloudflare Workers secrets..."

if [ ! -f .dev.vars ]; then
  echo "Error: .dev.vars file not found"
  exit 1
fi

while IFS='=' read -r key value; do
  if [[ ! $key =~ ^# ]] && [[ -n $key ]]; then
    echo "Setting secret: $key"
    echo "$value" | wrangler secret put "$key"
  fi
done < .dev.vars

echo "All secrets uploaded."
```

### DEPLOYMENT = edge — `src/edge.ts`

#### Vercel Edge Functions

```typescript
import { handle } from "hono/vercel";
import { createApp } from "./app.js";

const app = createApp({
  PORT: 3000,
  NODE_ENV: "production",
  // Map from process.env or Vercel env
  API_KEY: process.env.API_KEY!,
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
```

**Also create `vercel.json`:**

```json
{
  "buildCommand": "bun run build",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
}
```

#### Deno Deploy

```typescript
import { createApp } from "./app.ts";

const app = createApp({
  PORT: 8000,
  NODE_ENV: "production",
  API_KEY: Deno.env.get("API_KEY")!,
});

Deno.serve({ port: 8000 }, app.fetch);
```

**Note:** Deno uses `.ts` imports (no `.js` extension hack needed).

---

## Step 8: Create Environment Files

**.env.example:**

```env
PORT=5000
NODE_ENV=development
API_KEY=your-api-key-here
# Add service-specific variables below
```

**.env:**

```env
# Copy from .env.example and fill with actual values
```

**If DEPLOYMENT includes `cloudflare`**, also create `.dev.vars` (same shape as `.env` but for Workers local dev).

---

## Step 9: Create Vitest Config (vite.config.ts)

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

---

## Step 10: Create README.md

Include:
- Description and features
- Prerequisites (Bun or Node version, etc.)
- Quick start guide
- Environment variables table (with types, defaults, and required/optional)
- API documentation reference (link to `/docs`)
- Deployment instructions for each configured target
- Testing instructions
- Troubleshooting section

---

## Step 11: Monorepo Integration (STRUCTURE = monorepo only)

Skip this step entirely for standalone projects.

### Add as workspace dependency

In the consuming package's `package.json`:

```json
{
  "dependencies": {
    "@service/[service-name]": "workspace:*"
  }
}
```

### Import and use

```typescript
import { ServiceClass } from "@service/[service-name]";

const service = new ServiceClass({ /* config */ });
const result = await service.someMethod();
```

---

## Environment Validation with @t3-oss/env-core (CRITICAL)

**This section applies to ALL configurations. NEVER skip env.ts.**

### Why It's Required

1. **Fail Fast** — catch configuration errors at startup, not at 3am in production
2. **Type Safety** — full autocomplete and type checking for every env var
3. **Self-Documentation** — the schema IS the documentation for required config
4. **Clear Errors** — know exactly what's missing or wrong
5. **No Runtime Surprises** — prevent `undefined` errors deep in business logic

### Common Mistakes

**WRONG — Direct process.env access:**

```typescript
const port = process.env.PORT; // string | undefined, no validation
const apiKey = process.env.API_KEY; // might be undefined, crashes later
```

**CORRECT — Use env.ts:**

```typescript
import { env } from "./env.js";
const port = env.PORT; // number — guaranteed, validated, typed
const apiKey = env.API_KEY; // string — validated on startup
```

**WRONG — Manual parsing:**

```typescript
const maxSize = parseInt(process.env.MAX_SIZE || "100");
// Silently returns NaN if MAX_SIZE is "abc"
```

**CORRECT — Use z.coerce:**

```typescript
// In env.ts
MAX_SIZE: z.coerce.number().default(100)
// Throws clear error if not a valid number
```

### Type Export Pattern

Always export the env type for reuse:

```typescript
// env.ts
export const env = createEnv({ ... });
export type Env = typeof env;

// app.ts
import type { Env } from "./env.js";
export function createApp(env: Env) { ... }
```

---

## Best Practices

### Route Organization
- Group related routes together
- Use consistent naming conventions
- Always use `createRoute()` for OpenAPI docs
- Tag routes for documentation organization

### Error Handling
- Return appropriate HTTP status codes
- Use Zod for request validation
- Include helpful error messages
- Log errors for debugging

### Environment Variables
- **ALWAYS** use `@t3-oss/env-core` — never access `process.env` directly
- On Bun: no dotenv needed. On Node: import `dotenv/config` before `createEnv()`
- Validate all required variables — fail fast on startup
- Use `z.coerce.number()` for numeric values, not `parseInt()`
- Use `.optional()` for truly optional variables
- Document all variables in README with types and defaults
- Never commit sensitive values
- Export `Env` type for use in other modules

### Testing
- Use Vitest for all runtimes
- Test happy paths and error cases
- Mock environment variables in tests using `vi.stubEnv()`

### Documentation
- Keep README up to date
- Let OpenAPI/Scalar be the source of truth for API docs
- Include code examples
- Document deployment steps per target

---

## Deployment Quick Reference

### Standalone Server (Bun)

```bash
bun run build
bun run start
```

### Standalone Server (Node)

```bash
npm run build   # or pnpm run build
npm run start   # or pnpm run start
```

### Cloudflare Workers

```bash
# Upload secrets
npm run workers:secrets

# Deploy to production
npm run workers:deploy:prod

# Monitor logs
npm run workers:tail
```

### Vercel Edge

```bash
vercel deploy
```

---

## Common Gotchas

- **Missing env.ts** — NEVER use `process.env` directly. Always create `env.ts` with `@t3-oss/env-core`
- **Bun + dotenv** — Don't add `dotenv` when using Bun. It auto-loads `.env` files
- **Node + missing dotenv** — On Node, you MUST import `dotenv/config` before `createEnv()` or `.env` won't load
- **Type coercion** — Use `z.coerce.number()` for numbers, not `parseInt()`
- **Workers compatibility** — Not all Node.js APIs work in Workers (`fs`, `crypto`, `path`, etc.)
- **Edge limitations** — Edge runtimes have no file system, limited Node.js built-ins
- **OpenAPI schemas** — Must use `@hono/zod-openapi` import for Zod in schemas, not plain `zod`
- **ESM modules** — Use `type: "module"` in `package.json`
- **Port conflicts** — Check that PORT doesn't conflict with other services
- **Monorepo .env paths** — In monorepos on Node, resolve the `.env` path relative to the package root, not CWD

---

## Questions to Consider

Before creating a new service, ask:

1. Should this be a separate service or part of an existing API?
2. What runtime will it run on? (Bun or Node)
3. Where will it be deployed? (Server, Cloudflare Workers, Edge, multiple?)
4. Is this part of a monorepo or a standalone project?
5. What external dependencies does it require?
6. Will it be consumed as SDK, HTTP API, or both?
7. What environment variables does it need?
8. What are the authentication requirements?
