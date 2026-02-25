---
name: add-hono-route
description: Add a new API route to @kitnai/hono following the established pattern
---

# Add a Hono Route

Follow these steps to add a new API route domain to `@kitnai/hono`.

## 1. Create route directory

Create `packages/hono/src/routes/<domain>/` with two files.

## 2. (Optional) Add shared schemas to core

If the route needs shared Zod schemas, add them to `packages/core/src/schemas/<domain>.schemas.ts` and export from `packages/core/src/index.ts`.

## 3. Create handlers file

Create `<domain>.handlers.ts`:

```ts
import type { Context } from "hono";
import type { PluginContext } from "@kitnai/core";

export function create<Domain>Handlers(ctx: PluginContext) {
  const store = ctx.storage.<substore>;

  return {
    async handleList(c: Context) {
      const items = await store.list();
      return c.json({ items, count: items.length }, 200);
    },

    async handleGet(c: Context) {
      const id = c.req.param("id");
      const item = await store.get(id);
      if (!item) return c.json({ error: "Not found" }, 404);
      return c.json(item, 200);
    },

    // Add more handlers as needed...
  };
}
```

## 4. Create routes file

Create `<domain>.routes.ts`:

```ts
import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";
import { create<Domain>Handlers } from "./<domain>.handlers.js";

export function create<Domain>Routes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const handlers = create<Domain>Handlers(ctx);

  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["<Domain>"],
      summary: "List all <domain> items",
      responses: {
        200: {
          description: "All items",
          content: {
            "application/json": {
              schema: z.object({ items: z.array(z.string()), count: z.number() }),
            },
          },
        },
      },
    }),
    handlers.handleList,
  );

  // Add more routes...

  return router;
}
```

## 5. Mount in plugin.ts

Edit `packages/hono/src/plugin.ts`:

1. Add import: `import { create<Domain>Routes } from "./routes/<domain>/<domain>.routes.js";`
2. Add mount: `app.route("/<domain>", create<Domain>Routes(ctx));` (after existing `app.route` calls)

## 6. Verify

```bash
bun run typecheck
bun run test
```

## Reference files

- Route pattern: `packages/hono/src/routes/memory/memory.routes.ts`
- Handler pattern: `packages/hono/src/routes/memory/memory.handlers.ts`
- Plugin mount point: `packages/hono/src/plugin.ts`
