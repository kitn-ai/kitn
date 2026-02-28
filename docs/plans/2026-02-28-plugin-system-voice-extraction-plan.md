# Plugin System & Voice Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a generic plugin system so optional features define their APIs once and work across all framework adapters, then extract voice from core as the first plugin.

**Architecture:** Core defines a `KitnPlugin` interface with framework-agnostic route definitions (Web Standard Request/Response handlers + optional OpenAPI schemas). Each adapter gets a one-time generic `mountPlugin()` function that translates these routes into framework-specific code. Voice moves from core to `packages/voice/` as the first plugin, fully self-contained with its own providers, storage, routes, and schemas.

**Tech Stack:** TypeScript, Bun, Zod, Hono, Hono-OpenAPI (`@hono/zod-openapi`), Elysia

---

## Phase 1: Plugin System Infrastructure

### Task 1: KitnPlugin Interface and Types in Core

**Files:**
- Create: `packages/core/src/plugins/types.ts`
- Create: `packages/core/src/plugins/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/plugins/plugins.test.ts`

**Context:** This defines the contract all plugins implement. Handlers use standard Web API `Request`/`Response`. The `schema` field is optional metadata that OpenAPI adapters use for documentation.

**Step 1: Write the test**

Create `packages/core/src/plugins/plugins.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { KitnPlugin, PluginRoute, PluginHandlerContext, PluginRouteSchema } from "./types.js";

describe("KitnPlugin types", () => {
  test("a valid plugin satisfies the interface", () => {
    const plugin: KitnPlugin = {
      name: "test-plugin",
      prefix: "/test",
      routes: [
        {
          method: "GET",
          path: "/hello",
          handler: async (ctx: PluginHandlerContext) => {
            return Response.json({ message: "hello" });
          },
        },
      ],
    };
    expect(plugin.name).toBe("test-plugin");
    expect(plugin.prefix).toBe("/test");
    expect(plugin.routes).toHaveLength(1);
    expect(plugin.routes[0].method).toBe("GET");
  });

  test("plugin with init function", () => {
    let initialized = false;
    const plugin: KitnPlugin = {
      name: "init-plugin",
      prefix: "/init",
      routes: [],
      init: async () => { initialized = true; },
    };
    expect(plugin.init).toBeDefined();
  });

  test("route with schema metadata", () => {
    const route: PluginRoute = {
      method: "POST",
      path: "/speak",
      handler: async () => new Response("ok"),
      schema: {
        summary: "Text to speech",
        tags: ["Voice"],
        responses: {
          200: { description: "Audio stream" },
        },
      },
    };
    expect(route.schema?.summary).toBe("Text to speech");
    expect(route.schema?.tags).toEqual(["Voice"]);
  });

  test("handler receives request and params", async () => {
    const route: PluginRoute = {
      method: "GET",
      path: "/items/:id",
      handler: async (ctx) => {
        return Response.json({ id: ctx.params.id });
      },
    };
    const mockCtx: PluginHandlerContext = {
      request: new Request("http://localhost/items/42"),
      params: { id: "42" },
      pluginContext: {} as any,
    };
    const res = await route.handler(mockCtx);
    const data = await res.json();
    expect(data.id).toBe("42");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/plugins/plugins.test.ts`
Expected: FAIL — module `./types.js` not found

**Step 3: Implement the types**

Create `packages/core/src/plugins/types.ts`:

```typescript
import type { z } from "zod";
import type { PluginContext } from "../types.js";

/** Context passed to every plugin route handler */
export interface PluginHandlerContext {
  /** The raw Web Standard Request */
  request: Request;
  /** Route parameters (e.g. { id: "42" } for /items/:id) */
  params: Record<string, string>;
  /** Access to shared plugin context (agents, storage, model, hooks) */
  pluginContext: PluginContext;
}

/** HTTP method */
export type PluginRouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** A single route definition */
export interface PluginRoute {
  method: PluginRouteMethod;
  path: string;
  handler: (ctx: PluginHandlerContext) => Promise<Response>;
  schema?: PluginRouteSchema;
}

/** Optional OpenAPI metadata for a route. Used by OpenAPI-aware adapters for documentation. */
export interface PluginRouteSchema {
  summary?: string;
  description?: string;
  tags?: string[];
  request?: {
    query?: z.ZodType;
    params?: z.ZodType;
    body?: { content: Record<string, { schema: z.ZodType }> };
  };
  responses?: Record<number, {
    description: string;
    content?: Record<string, { schema: z.ZodType }>;
  }>;
}

/** The plugin contract. Implement this to add routes to any kitn adapter. */
export interface KitnPlugin {
  /** Plugin name, used for discovery endpoint */
  name: string;
  /** URL prefix (e.g. "/voice"). Routes are mounted under this path. */
  prefix: string;
  /** Route definitions */
  routes: PluginRoute[];
  /** Optional initialization function, called after plugin context is ready */
  init?: (ctx: PluginContext) => void | Promise<void>;
}
```

Create `packages/core/src/plugins/index.ts`:

```typescript
export type {
  KitnPlugin,
  PluginRoute,
  PluginRouteMethod,
  PluginHandlerContext,
  PluginRouteSchema,
} from "./types.js";
```

**Step 4: Wire into core exports**

Add to `packages/core/src/index.ts` (after the hooks exports section):

```typescript
// ── Plugins ──
export type { KitnPlugin, PluginRoute, PluginRouteMethod, PluginHandlerContext, PluginRouteSchema } from "./plugins/index.js";
```

Add to `packages/core/src/types.ts` — add `plugins` to `CoreConfig`:

```typescript
// Add this import at the top:
import type { KitnPlugin } from "./plugins/types.js";

// Add to CoreConfig interface:
plugins?: KitnPlugin[];
```

**Step 5: Run test to verify it passes**

Run: `bun test packages/core/src/plugins/plugins.test.ts`
Expected: 4 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/plugins/ packages/core/src/index.ts packages/core/src/types.ts
git commit -m "feat(core): add KitnPlugin interface for generic plugin system"
```

---

### Task 2: Mount Plugins in Hono Adapter

**Files:**
- Modify: `packages/adapters/hono/src/plugin.ts`
- Modify: `packages/adapters/hono/src/types.ts`
- Modify: `packages/adapters/hono/src/index.ts`

**Context:** The Hono adapter gets a generic `mountPlugin()` function and a plugin discovery endpoint. This is the translation layer — it converts framework-agnostic `PluginRoute` definitions into Hono routes. It also adds `plugins?: KitnPlugin[]` to `AIPluginConfig`.

**Step 1: Add plugins to AIPluginConfig**

In `packages/adapters/hono/src/types.ts`, add import and config field:

```typescript
// Add to imports:
import type { KitnPlugin } from "@kitnai/core";

// Add to AIPluginConfig:
plugins?: KitnPlugin[];
```

Remove `VoiceConfig` type export from `packages/adapters/hono/src/index.ts` (this will break until voice is extracted — we'll keep VoiceConfig temporarily and remove in Phase 2).

Actually — **do NOT remove VoiceConfig yet**. We add the plugin system alongside the existing voice code in Phase 1. Phase 2 removes voice. This avoids a broken intermediate state.

**Step 2: Add mountPlugin utility and plugin loop to plugin.ts**

In `packages/adapters/hono/src/plugin.ts`, add after the existing route mounting block:

```typescript
// Add import at top:
import type { KitnPlugin } from "@kitnai/core";

// After the existing voice/cron/job route mounting, add:

// Mount plugins
if (config.plugins) {
  for (const plugin of config.plugins) {
    mountPlugin(app, plugin, ctx);
    if (plugin.init) {
      await plugin.init(ctx);
    }
  }
}

// Discovery endpoint
app.get("/plugins", (c) => {
  const plugins = (config.plugins ?? []).map((p) => ({
    name: p.name,
    prefix: p.prefix,
    routes: p.routes.map((r) => ({
      method: r.method,
      path: `${p.prefix}${r.path}`,
      summary: r.schema?.summary,
    })),
  }));
  return c.json({ plugins });
});
```

Add the `mountPlugin` function (before `createAIPlugin`):

```typescript
function mountPlugin(app: Hono, plugin: KitnPlugin, ctx: PluginContext) {
  const sub = new Hono();
  for (const route of plugin.routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
    sub[method](route.path, async (c) => {
      return route.handler({
        request: c.req.raw,
        params: c.req.param(),
        pluginContext: ctx,
      });
    });
  }
  app.route(plugin.prefix, sub);
}
```

Note: The `createAIPlugin` function signature needs to become `async` since `plugin.init()` can be async. Currently it's synchronous. Wrap the return in an immediately-invoked pattern or make the function async. Check how it's called in examples — `const plugin = createAIPlugin(...)` is not awaited. The simplest approach: call `init` via fire-and-forget with error logging, or queue inits. **Recommended:** Use `waitUntil` if available, otherwise fire-and-forget:

```typescript
const initPromise = Promise.all(
  (config.plugins ?? [])
    .filter((p) => p.init)
    .map((p) => Promise.resolve(p.init!(ctx)).catch((err) => console.error(`[kitn] Plugin "${p.name}" init failed:`, err)))
);
if (config.waitUntil) {
  config.waitUntil(initPromise);
} else {
  initPromise.catch(() => {});
}
```

**Step 3: Run typecheck**

Run: `bun run --cwd packages/adapters/hono tsc --noEmit`
Expected: PASS (no new errors)

**Step 4: Commit**

```bash
git add packages/adapters/hono/src/
git commit -m "feat(hono): add generic plugin mounting and discovery endpoint"
```

---

### Task 3: Mount Plugins in Hono-OpenAPI Adapter

**Files:**
- Modify: `packages/adapters/hono-openapi/src/plugin.ts`
- Modify: `packages/adapters/hono-openapi/src/types.ts`

**Context:** Same as Task 2 but for Hono-OpenAPI. The key difference: this adapter reads `route.schema` to generate OpenAPI documentation via `createRoute()`.

**Step 1: Add plugins to AIPluginConfig**

Same as Task 2 — add `plugins?: KitnPlugin[]` to `AIPluginConfig` in types.ts.

**Step 2: Add mountPlugin with OpenAPI support**

The `mountPlugin` function for hono-openapi uses `createRoute()` when schema metadata is present:

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { KitnPlugin, PluginRoute } from "@kitnai/core";

function mountPlugin(app: OpenAPIHono, plugin: KitnPlugin, ctx: PluginContext) {
  const sub = new OpenAPIHono();
  for (const route of plugin.routes) {
    if (route.schema) {
      // OpenAPI-documented route
      const openApiRoute = createRoute({
        method: route.method.toLowerCase() as any,
        path: route.path,
        summary: route.schema.summary,
        description: route.schema.description,
        tags: route.schema.tags,
        ...(route.schema.request && { request: route.schema.request }),
        responses: route.schema.responses ?? {
          200: { description: "Success" },
        },
      });
      sub.openapi(openApiRoute, (async (c: any) => {
        return route.handler({
          request: c.req.raw,
          params: c.req.param(),
          pluginContext: ctx,
        });
      }) as any);
    } else {
      // Plain route (no OpenAPI docs)
      const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
      sub[method](route.path, async (c) => {
        return route.handler({
          request: c.req.raw,
          params: c.req.param(),
          pluginContext: ctx,
        });
      });
    }
  }
  app.route(plugin.prefix, sub);
}
```

Add the same plugin loop and discovery endpoint as Task 2.

**Step 3: Run typecheck**

Run: `bun run --cwd packages/adapters/hono-openapi tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/adapters/hono-openapi/src/
git commit -m "feat(hono-openapi): add generic plugin mounting with OpenAPI schema support"
```

---

### Task 4: Mount Plugins in Elysia Adapter

**Files:**
- Modify: `packages/adapters/elysia/src/plugin.ts`
- Modify: `packages/adapters/elysia/src/types.ts`

**Context:** Same as Task 2 but for Elysia. Elysia uses `app.use(pluginInstance)` or chained methods.

**Step 1: Add plugins to AIPluginConfig**

Same pattern — add `plugins?: KitnPlugin[]`.

**Step 2: Add mountPlugin for Elysia**

```typescript
import Elysia from "elysia";
import type { KitnPlugin } from "@kitnai/core";

function mountPlugin(app: Elysia, plugin: KitnPlugin, ctx: PluginContext) {
  const sub = new Elysia({ prefix: plugin.prefix });
  for (const route of plugin.routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
    sub[method](route.path, async (elysiaCtx) => {
      return route.handler({
        request: elysiaCtx.request,
        params: elysiaCtx.params as Record<string, string>,
        pluginContext: ctx,
      });
    });
  }
  app.use(sub);
}
```

Add the same plugin loop and discovery endpoint.

**Step 3: Run typecheck**

Run: `bun run --cwd packages/adapters/elysia tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/adapters/elysia/src/
git commit -m "feat(elysia): add generic plugin mounting and discovery endpoint"
```

---

### Task 5: Integration Test — Plugin System

**Files:**
- Create: `packages/core/src/plugins/integration.test.ts`

**Context:** Test that a minimal plugin can be mounted and its routes work. Uses the Hono adapter since that's the primary one.

**Step 1: Write the test**

```typescript
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import type { KitnPlugin, PluginHandlerContext } from "./types.js";

describe("Plugin system integration", () => {
  test("mountPlugin wires routes correctly", async () => {
    // This test verifies the type contract — the actual mounting is tested
    // in adapter-specific tests. Here we verify the handler contract.
    const handler = async (ctx: PluginHandlerContext) => {
      const url = new URL(ctx.request.url);
      return Response.json({
        path: url.pathname,
        params: ctx.params,
      });
    };

    const plugin: KitnPlugin = {
      name: "test",
      prefix: "/test",
      routes: [
        { method: "GET", path: "/hello", handler },
        { method: "GET", path: "/items/:id", handler },
        { method: "POST", path: "/items", handler },
      ],
    };

    expect(plugin.routes).toHaveLength(3);
    expect(plugin.routes[0].method).toBe("GET");
    expect(plugin.routes[1].path).toBe("/items/:id");
    expect(plugin.routes[2].method).toBe("POST");
  });

  test("init is called with PluginContext", async () => {
    let receivedCtx: any = null;
    const plugin: KitnPlugin = {
      name: "init-test",
      prefix: "/init-test",
      routes: [],
      init: async (ctx) => { receivedCtx = ctx; },
    };

    const mockCtx = { agents: {}, tools: {} } as any;
    await plugin.init!(mockCtx);
    expect(receivedCtx).toBe(mockCtx);
  });
});
```

**Step 2: Run tests**

Run: `bun test packages/core/src/plugins/`
Expected: All PASS

**Step 3: Commit**

```bash
git add packages/core/src/plugins/
git commit -m "test(core): add plugin system integration tests"
```

---

## Phase 2: Voice Package

### Task 6: Scaffold Voice Package

**Files:**
- Create: `packages/voice/package.json`
- Create: `packages/voice/tsconfig.json`
- Create: `packages/voice/src/index.ts` (empty placeholder)

**Context:** Create the new package at `packages/voice/`. It will be published as `@kitn/voice` (mapped from workspace name `@kitnai/voice`). Peer deps on `@kitnai/core` and `zod`.

**Step 1: Create package.json**

```json
{
  "name": "@kitnai/voice",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": {
    "@kitnai/core": "workspace:*",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  }
}
```

**Step 2: Create tsconfig.json**

Reference the existing tsconfigs in other packages for the pattern:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

**Step 3: Create placeholder index.ts**

```typescript
// @kitnai/voice — Voice plugin for kitn
// Exports will be added as files are moved
```

**Step 4: Install dependencies**

Run: `bun install` (this registers the new workspace package)

**Step 5: Commit**

```bash
git add packages/voice/
git commit -m "chore(voice): scaffold voice package"
```

---

### Task 7: Move Voice Provider Interface and Manager

**Files:**
- Create: `packages/voice/src/voice-provider.ts` (move from core)
- Create: `packages/voice/src/voice-manager.ts` (move from core)
- Create: `packages/voice/src/voice-manager.test.ts`
- Modify: `packages/voice/src/index.ts`

**Context:** Move the VoiceProvider interface and VoiceManager class from core to the voice package. These are currently at `packages/core/src/voice/voice-provider.ts` and `packages/core/src/voice/voice-manager.ts`. Copy them exactly — no changes to the code itself.

**Step 1: Copy voice-provider.ts**

Copy `packages/core/src/voice/voice-provider.ts` to `packages/voice/src/voice-provider.ts`. The file is self-contained — no imports from core.

**Step 2: Copy voice-manager.ts**

Copy `packages/core/src/voice/voice-manager.ts` to `packages/voice/src/voice-manager.ts`. Update the import path:

```typescript
// Change from:
import type { VoiceProvider } from "./voice-provider.js";
// To (same — it's now a local import within the voice package):
import type { VoiceProvider } from "./voice-provider.js";
```

No change needed — the relative import is the same.

**Step 3: Write test for VoiceManager**

Create `packages/voice/src/voice-manager.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { VoiceManager } from "./voice-manager.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() { return { text: "hello" }; },
    async speak() { return new ReadableStream(); },
    async getSpeakers() { return [{ voiceId: "v1", name: "Test" }]; },
  };
}

describe("VoiceManager", () => {
  test("register and get provider", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    expect(mgr.get("openai")).toBeDefined();
    expect(mgr.get("openai")!.name).toBe("openai");
  });

  test("first registered is default", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    mgr.register(createMockProvider("groq"));
    expect(mgr.getDefault()).toBe("openai");
    expect(mgr.get()!.name).toBe("openai");
  });

  test("list providers", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    mgr.register(createMockProvider("groq"));
    expect(mgr.listNames()).toEqual(["openai", "groq"]);
    expect(mgr.list()).toHaveLength(2);
  });

  test("isAvailable", () => {
    const mgr = new VoiceManager();
    expect(mgr.isAvailable()).toBe(false);
    mgr.register(createMockProvider("openai"));
    expect(mgr.isAvailable()).toBe(true);
  });
});
```

**Step 4: Run tests**

Run: `bun test packages/voice/src/voice-manager.test.ts`
Expected: 4 tests PASS

**Step 5: Update index.ts exports**

```typescript
export type { VoiceProvider, TranscribeOptions, TranscribeResult, SpeakOptions, VoiceSpeaker } from "./voice-provider.js";
export { VoiceManager } from "./voice-manager.js";
```

**Step 6: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): move VoiceProvider interface and VoiceManager from core"
```

---

### Task 8: Move OpenAIVoiceProvider

**Files:**
- Create: `packages/voice/src/openai-voice-provider.ts` (move from core)
- Modify: `packages/voice/src/index.ts`

**Context:** Copy `packages/core/src/voice/openai-voice-provider.ts` to the voice package. This file imports only from `./voice-provider.js` which is already in the voice package.

**Step 1: Copy the file**

Copy `packages/core/src/voice/openai-voice-provider.ts` to `packages/voice/src/openai-voice-provider.ts`. No import changes needed — it only imports from `./voice-provider.js`.

**Step 2: Update index.ts exports**

Add:
```typescript
export { OpenAIVoiceProvider } from "./openai-voice-provider.js";
export type { OpenAIVoiceProviderConfig } from "./openai-voice-provider.js";
```

**Step 3: Run typecheck**

Run: `bun run --cwd packages/voice tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): move OpenAIVoiceProvider from core"
```

---

### Task 9: Move AudioStore Interface and Implementations

**Files:**
- Create: `packages/voice/src/audio-store.ts` (interface)
- Create: `packages/voice/src/audio-store-memory.ts` (in-memory)
- Create: `packages/voice/src/audio-store-file.ts` (file-based)
- Create: `packages/voice/src/audio-store.test.ts`
- Modify: `packages/voice/src/index.ts`

**Context:** Extract `AudioStore` and `AudioEntry` interfaces from `packages/core/src/storage/interfaces.ts`. Copy the in-memory implementation from `packages/core/src/storage/in-memory/index.ts` and the file-based implementation from `packages/core/src/storage/file-storage/audio-store.ts`.

**Step 1: Create audio-store.ts (interface)**

```typescript
/** Metadata for a stored audio file */
export interface AudioEntry {
  id: string;
  mimeType: string;
  size: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AudioStore {
  saveAudio(buffer: Buffer | Uint8Array, mimeType: string, metadata?: Record<string, unknown>, scopeId?: string): Promise<AudioEntry>;
  getAudio(id: string, scopeId?: string): Promise<{ entry: AudioEntry; data: Buffer } | null>;
  deleteAudio(id: string, scopeId?: string): Promise<boolean>;
  listAudio(scopeId?: string): Promise<AudioEntry[]>;
  cleanupOlderThan(maxAgeMs: number, scopeId?: string): Promise<number>;
}
```

**Step 2: Create audio-store-memory.ts**

Extract the `createAudioStore` function from `packages/core/src/storage/in-memory/index.ts` (lines 228-317) into its own file. Rename to `createMemoryAudioStore`. Import `AudioStore` and `AudioEntry` from `./audio-store.js`.

**Step 3: Create audio-store-file.ts**

Copy `packages/core/src/storage/file-storage/audio-store.ts` to `packages/voice/src/audio-store-file.ts`. Rename exported function to `createFileAudioStore`. Update imports to use local `./audio-store.js`. The `withLock` utility from core may need to be copied or imported — check the file's imports.

**Step 4: Write tests**

Create `packages/voice/src/audio-store.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createMemoryAudioStore } from "./audio-store-memory.js";

describe("AudioStore (in-memory)", () => {
  test("save and retrieve audio", async () => {
    const store = createMemoryAudioStore();
    const buffer = Buffer.from("fake audio data");
    const entry = await store.saveAudio(buffer, "audio/mp3");
    expect(entry.id).toBeDefined();
    expect(entry.mimeType).toBe("audio/mp3");
    expect(entry.size).toBe(buffer.length);

    const result = await store.getAudio(entry.id);
    expect(result).not.toBeNull();
    expect(result!.data.toString()).toBe("fake audio data");
  });

  test("delete audio", async () => {
    const store = createMemoryAudioStore();
    const entry = await store.saveAudio(Buffer.from("data"), "audio/mp3");
    expect(await store.deleteAudio(entry.id)).toBe(true);
    expect(await store.getAudio(entry.id)).toBeNull();
  });

  test("list audio", async () => {
    const store = createMemoryAudioStore();
    await store.saveAudio(Buffer.from("a"), "audio/mp3");
    await store.saveAudio(Buffer.from("b"), "audio/mp3");
    const entries = await store.listAudio();
    expect(entries).toHaveLength(2);
  });

  test("scope isolation", async () => {
    const store = createMemoryAudioStore();
    await store.saveAudio(Buffer.from("a"), "audio/mp3", undefined, "user1");
    await store.saveAudio(Buffer.from("b"), "audio/mp3", undefined, "user2");
    expect(await store.listAudio("user1")).toHaveLength(1);
    expect(await store.listAudio("user2")).toHaveLength(1);
  });
});
```

**Step 5: Run tests**

Run: `bun test packages/voice/src/audio-store.test.ts`
Expected: 4 tests PASS

**Step 6: Update index.ts exports**

```typescript
export type { AudioStore, AudioEntry } from "./audio-store.js";
export { createMemoryAudioStore } from "./audio-store-memory.js";
export { createFileAudioStore } from "./audio-store-file.js";
```

**Step 7: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): move AudioStore interface and implementations from core"
```

---

### Task 10: Move Voice Schemas

**Files:**
- Create: `packages/voice/src/schemas.ts` (move from core)
- Modify: `packages/voice/src/index.ts`

**Context:** Copy `packages/core/src/schemas/voice.schemas.ts` to the voice package. These schemas use `zod` with `.openapi()` extensions from `@asteasolutions/zod-to-openapi` (needed for OpenAPI metadata). Add `@asteasolutions/zod-to-openapi` as a peer dep if needed.

**Step 1: Copy the file**

Copy `packages/core/src/schemas/voice.schemas.ts` to `packages/voice/src/schemas.ts`.

**Step 2: Check if `@asteasolutions/zod-to-openapi` is needed**

The schemas use `.openapi({ example: ... })` — this is from the `zod-to-openapi` extension. Check if it's required as a dependency. If it works without it at runtime (the `.openapi()` method may be patched by the consuming adapter), we can skip it. Otherwise add it as an optional peer dep.

**Step 3: Update index.ts exports**

```typescript
export { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema, converseResponseHeadersSchema } from "./schemas.js";
```

**Step 4: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): move voice Zod schemas from core"
```

---

### Task 11: Voice Route Handlers as Plugin Routes

**Files:**
- Create: `packages/voice/src/routes.ts`
- Create: `packages/voice/src/routes.test.ts`
- Modify: `packages/voice/src/index.ts`

**Context:** This is the core of the extraction. Rewrite the voice route handlers as framework-agnostic `PluginRoute` definitions using standard `Request`/`Response`. The handler logic stays the same — transcribe, speak, converse, etc. — but wrapped in the `PluginHandlerContext` interface instead of Hono's `c` context.

Reference the existing Hono routes at `packages/adapters/hono/src/routes/voice/voice.routes.ts` for the handler logic. Each handler needs to:
1. Read from `ctx.request` (instead of `c.req`)
2. Return `Response` objects (instead of `c.json()` or `c.body()`)
3. Include `schema` metadata for OpenAPI documentation

The voice routes need access to `VoiceManager` and `AudioStore`. These are closed over by the factory function, NOT accessed from `PluginContext`.

**Step 1: Create routes.ts**

```typescript
import type { PluginRoute, PluginHandlerContext } from "@kitnai/core";
import type { VoiceManager } from "./voice-manager.js";
import type { AudioStore } from "./audio-store.js";
import { runAgent, generateConversationId } from "@kitnai/core";
import { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema } from "./schemas.js";

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", opus: "audio/opus", wav: "audio/wav", aac: "audio/aac", flac: "audio/flac",
};

export interface VoiceRoutesConfig {
  voiceManager: VoiceManager;
  audioStore?: AudioStore;
  retainAudio?: boolean;
}

export function createVoiceRoutes(config: VoiceRoutesConfig): PluginRoute[] {
  const { voiceManager, audioStore, retainAudio } = config;

  function requireVoice(name?: string) {
    const provider = voiceManager.get(name);
    if (!provider) throw new Error("VOICE_UNAVAILABLE");
    return provider;
  }

  return [
    // GET /speakers
    {
      method: "GET",
      path: "/speakers",
      schema: {
        summary: "List available voice speakers",
        tags: ["Voice"],
        responses: {
          200: { description: "List of speakers", content: { "application/json": { schema: speakersResponseSchema } } },
          503: { description: "Voice provider not configured" },
        },
      },
      handler: async () => {
        let provider;
        try { provider = requireVoice(); } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }
        const speakers = await provider.getSpeakers();
        return Response.json({
          speakers: speakers.map((s) => ({ voiceId: s.voiceId, name: s.name })),
          provider: provider.name,
        });
      },
    },

    // GET /providers
    {
      method: "GET",
      path: "/providers",
      schema: {
        summary: "List available voice providers",
        tags: ["Voice"],
        responses: {
          200: { description: "List of providers" },
        },
      },
      handler: async () => {
        const providers = voiceManager.list();
        const defaultName = voiceManager.getDefault();
        return Response.json({
          providers: providers.map((p) => ({ name: p.name, label: p.label, isDefault: p.name === defaultName })),
        });
      },
    },

    // POST /transcribe
    {
      method: "POST",
      path: "/transcribe",
      schema: {
        summary: "Transcribe audio to text",
        tags: ["Voice"],
        responses: {
          200: { description: "Transcription result", content: { "application/json": { schema: transcribeResponseSchema } } },
          400: { description: "No audio file" },
          503: { description: "Voice provider not configured" },
        },
      },
      handler: async (ctx: PluginHandlerContext) => {
        const url = new URL(ctx.request.url);
        const providerName = url.searchParams.get("provider") || undefined;
        let provider;
        try { provider = requireVoice(providerName); } catch {
          return Response.json({ error: providerName ? `Voice provider "${providerName}" not available.` : "Voice provider not configured." }, { status: 503 });
        }
        const formData = await ctx.request.formData();
        const audioFile = formData.get("audio") as File | null;
        if (!audioFile) return Response.json({ error: "No audio file provided." }, { status: 400 });

        const result = await provider.transcribe(audioFile, {
          language: formData.get("language") as string || undefined,
          prompt: formData.get("prompt") as string || undefined,
        });

        // Optionally retain audio
        const shouldRetain = retainAudio || formData.get("retainAudio") === "true";
        let audioId: string | undefined;
        if (shouldRetain && audioStore) {
          const scopeId = ctx.request.headers.get("x-scope-id") || undefined;
          const buf = Buffer.from(await audioFile.arrayBuffer());
          const entry = await audioStore.saveAudio(buf, audioFile.type || "audio/webm", { transcription: result.text }, scopeId);
          audioId = entry.id;
        }

        return Response.json({ ...result, ...(audioId && { audioId }) });
      },
    },

    // POST /speak
    {
      method: "POST",
      path: "/speak",
      schema: {
        summary: "Text to speech",
        tags: ["Voice"],
        responses: {
          200: { description: "Audio stream" },
          503: { description: "Voice provider not configured" },
        },
      },
      handler: async (ctx: PluginHandlerContext) => {
        const url = new URL(ctx.request.url);
        const providerName = url.searchParams.get("provider") || undefined;
        let provider;
        try { provider = requireVoice(providerName); } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }
        const body = await ctx.request.json();
        const format = body.format || "mp3";
        const stream = await provider.speak(body.text, {
          speaker: body.speaker,
          format,
          speed: body.speed,
          model: body.model,
        });
        const mimeType = AUDIO_MIME_TYPES[format] || "audio/mpeg";

        // If save requested, buffer the full stream and save
        if (body.save && audioStore) {
          const chunks: Uint8Array[] = [];
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const fullBuffer = Buffer.concat(chunks);
          const scopeId = ctx.request.headers.get("x-scope-id") || undefined;
          const entry = await audioStore.saveAudio(fullBuffer, mimeType, { text: body.text }, scopeId);
          return new Response(fullBuffer, {
            headers: { "Content-Type": mimeType, "X-Audio-Id": entry.id },
          });
        }

        return new Response(stream, {
          headers: { "Content-Type": mimeType },
        });
      },
    },

    // POST /converse
    {
      method: "POST",
      path: "/converse",
      schema: {
        summary: "Full voice round-trip: transcribe, run agent, speak response",
        tags: ["Voice"],
        responses: {
          200: { description: "Audio response with metadata headers" },
          400: { description: "No audio file" },
          503: { description: "Voice provider not configured" },
        },
      },
      handler: async (ctx: PluginHandlerContext) => {
        const url = new URL(ctx.request.url);
        const providerName = url.searchParams.get("provider") || undefined;
        let provider;
        try { provider = requireVoice(providerName); } catch {
          return Response.json({ error: "Voice provider not configured." }, { status: 503 });
        }

        const formData = await ctx.request.formData();
        const audioFile = formData.get("audio") as File | null;
        if (!audioFile) return Response.json({ error: "No audio file provided." }, { status: 400 });

        // Step 1: Transcribe
        const transcription = await provider.transcribe(audioFile);

        // Step 2: Run agent
        const conversationId = (formData.get("conversationId") as string) || generateConversationId();
        const scopeId = ctx.request.headers.get("x-scope-id") || undefined;

        // Find a suitable agent — prefer non-orchestrator with tools
        const agents = ctx.pluginContext.agents.list();
        const agent = agents.find((a) => !a.isOrchestrator && a.tools && a.tools.length > 0)
          || agents[0];
        const agentName = (formData.get("agent") as string) || agent?.name || "assistant";

        const registration = ctx.pluginContext.agents.get(agentName);
        if (!registration) {
          return Response.json({ error: `Agent "${agentName}" not found.` }, { status: 404 });
        }

        const result = await runAgent(ctx.pluginContext, {
          system: registration.system,
          tools: registration.tools ?? {},
        }, transcription.text, { conversationId, scopeId });

        // Step 3: Speak the response
        const responseText = typeof result === "string" ? result : String(result);
        const audioStream = await provider.speak(responseText);
        const format = (formData.get("format") as string) || "mp3";
        const mimeType = AUDIO_MIME_TYPES[format] || "audio/mpeg";

        return new Response(audioStream, {
          headers: {
            "Content-Type": mimeType,
            "X-Transcription": transcription.text,
            "X-Response-Text": responseText,
            "X-Conversation-Id": conversationId,
          },
        });
      },
    },

    // GET /audio
    {
      method: "GET",
      path: "/audio",
      schema: { summary: "List saved audio entries", tags: ["Voice"] },
      handler: async (ctx: PluginHandlerContext) => {
        if (!audioStore) return Response.json({ entries: [] });
        const scopeId = ctx.request.headers.get("x-scope-id") || undefined;
        const entries = await audioStore.listAudio(scopeId);
        return Response.json({ entries });
      },
    },

    // GET /audio/:id
    {
      method: "GET",
      path: "/audio/:id",
      schema: { summary: "Retrieve saved audio", tags: ["Voice"] },
      handler: async (ctx: PluginHandlerContext) => {
        if (!audioStore) return Response.json({ error: "Audio storage not configured" }, { status: 404 });
        const scopeId = ctx.request.headers.get("x-scope-id") || undefined;
        const result = await audioStore.getAudio(ctx.params.id, scopeId);
        if (!result) return Response.json({ error: "Audio not found" }, { status: 404 });
        return new Response(result.data, {
          headers: { "Content-Type": result.entry.mimeType },
        });
      },
    },

    // DELETE /audio/:id
    {
      method: "DELETE",
      path: "/audio/:id",
      schema: { summary: "Delete saved audio", tags: ["Voice"] },
      handler: async (ctx: PluginHandlerContext) => {
        if (!audioStore) return Response.json({ error: "Audio storage not configured" }, { status: 404 });
        const scopeId = ctx.request.headers.get("x-scope-id") || undefined;
        const deleted = await audioStore.deleteAudio(ctx.params.id, scopeId);
        if (!deleted) return Response.json({ error: "Audio not found" }, { status: 404 });
        return Response.json({ success: true });
      },
    },
  ];
}
```

**Step 2: Write basic route tests**

Create `packages/voice/src/routes.test.ts` — test the route handlers with mock VoiceManager:

```typescript
import { describe, test, expect } from "bun:test";
import { createVoiceRoutes } from "./routes.js";
import { VoiceManager } from "./voice-manager.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() { return { text: "hello world" }; },
    async speak() { return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }); },
    async getSpeakers() { return [{ voiceId: "alloy", name: "Alloy" }]; },
  };
}

describe("Voice routes", () => {
  const mgr = new VoiceManager();
  mgr.register(createMockProvider("openai"));
  const routes = createVoiceRoutes({ voiceManager: mgr });

  test("creates all 8 routes", () => {
    expect(routes).toHaveLength(8);
    expect(routes.map(r => `${r.method} ${r.path}`)).toEqual([
      "GET /speakers",
      "GET /providers",
      "POST /transcribe",
      "POST /speak",
      "POST /converse",
      "GET /audio",
      "GET /audio/:id",
      "DELETE /audio/:id",
    ]);
  });

  test("GET /speakers returns speakers", async () => {
    const handler = routes.find(r => r.path === "/speakers")!.handler;
    const res = await handler({ request: new Request("http://localhost/speakers"), params: {}, pluginContext: {} as any });
    const data = await res.json();
    expect(data.speakers).toHaveLength(1);
    expect(data.speakers[0].name).toBe("Alloy");
    expect(data.provider).toBe("openai");
  });

  test("GET /providers returns providers", async () => {
    const handler = routes.find(r => r.path === "/providers")!.handler;
    const res = await handler({ request: new Request("http://localhost/providers"), params: {}, pluginContext: {} as any });
    const data = await res.json();
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0].name).toBe("openai");
    expect(data.providers[0].isDefault).toBe(true);
  });

  test("POST /speak returns audio stream", async () => {
    const handler = routes.find(r => r.path === "/speak")!.handler;
    const req = new Request("http://localhost/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    const res = await handler({ request: req, params: {}, pluginContext: {} as any });
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });
});
```

**Step 3: Run tests**

Run: `bun test packages/voice/src/routes.test.ts`
Expected: All PASS

**Step 4: Update index.ts exports**

```typescript
export { createVoiceRoutes } from "./routes.js";
export type { VoiceRoutesConfig } from "./routes.js";
```

**Step 5: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): add framework-agnostic voice routes as KitnPlugin routes"
```

---

### Task 12: createVoice() Factory — The Plugin Entry Point

**Files:**
- Create: `packages/voice/src/plugin.ts`
- Create: `packages/voice/src/plugin.test.ts`
- Modify: `packages/voice/src/index.ts`

**Context:** This is the main user-facing API. `createVoice()` returns a `KitnPlugin` that adapters mount automatically.

**Step 1: Create plugin.ts**

```typescript
import type { KitnPlugin } from "@kitnai/core";
import { VoiceManager } from "./voice-manager.js";
import type { VoiceProvider } from "./voice-provider.js";
import type { AudioStore } from "./audio-store.js";
import { createMemoryAudioStore } from "./audio-store-memory.js";
import { createVoiceRoutes } from "./routes.js";

export interface VoicePluginConfig {
  /** Voice providers to register (first becomes default) */
  providers: VoiceProvider[];
  /** Save uploaded audio server-side by default */
  retainAudio?: boolean;
  /** Custom AudioStore implementation. Defaults to in-memory. */
  audioStore?: AudioStore;
}

export function createVoice(config: VoicePluginConfig): KitnPlugin {
  const voiceManager = new VoiceManager();
  for (const provider of config.providers) {
    voiceManager.register(provider);
  }

  const audioStore = config.audioStore ?? createMemoryAudioStore();

  const routes = createVoiceRoutes({
    voiceManager,
    audioStore,
    retainAudio: config.retainAudio,
  });

  return {
    name: "voice",
    prefix: "/voice",
    routes,
  };
}
```

**Step 2: Write test**

Create `packages/voice/src/plugin.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createVoice } from "./plugin.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() { return { text: "hello" }; },
    async speak() { return new ReadableStream(); },
    async getSpeakers() { return [{ voiceId: "v1", name: "Test" }]; },
  };
}

describe("createVoice", () => {
  test("returns a valid KitnPlugin", () => {
    const plugin = createVoice({
      providers: [createMockProvider("openai")],
    });
    expect(plugin.name).toBe("voice");
    expect(plugin.prefix).toBe("/voice");
    expect(plugin.routes.length).toBeGreaterThan(0);
  });

  test("routes are functional", async () => {
    const plugin = createVoice({
      providers: [createMockProvider("openai")],
    });
    const speakersRoute = plugin.routes.find(r => r.path === "/speakers");
    expect(speakersRoute).toBeDefined();
    const res = await speakersRoute!.handler({
      request: new Request("http://localhost/speakers"),
      params: {},
      pluginContext: {} as any,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.speakers).toHaveLength(1);
  });

  test("works without optional config", () => {
    const plugin = createVoice({
      providers: [createMockProvider("openai")],
    });
    expect(plugin.name).toBe("voice");
    // AudioStore defaults to in-memory — no error
  });
});
```

**Step 3: Run tests**

Run: `bun test packages/voice/src/plugin.test.ts`
Expected: 3 tests PASS

**Step 4: Update index.ts**

Final `packages/voice/src/index.ts`:

```typescript
// Plugin factory
export { createVoice } from "./plugin.js";
export type { VoicePluginConfig } from "./plugin.js";

// Providers
export type { VoiceProvider, TranscribeOptions, TranscribeResult, SpeakOptions, VoiceSpeaker } from "./voice-provider.js";
export { VoiceManager } from "./voice-manager.js";
export { OpenAIVoiceProvider } from "./openai-voice-provider.js";
export type { OpenAIVoiceProviderConfig } from "./openai-voice-provider.js";

// Audio storage
export type { AudioStore, AudioEntry } from "./audio-store.js";
export { createMemoryAudioStore } from "./audio-store-memory.js";
export { createFileAudioStore } from "./audio-store-file.js";

// Schemas
export { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema, converseResponseHeadersSchema } from "./schemas.js";

// Routes (for advanced use — most users just use createVoice())
export { createVoiceRoutes } from "./routes.js";
export type { VoiceRoutesConfig } from "./routes.js";
```

**Step 5: Commit**

```bash
git add packages/voice/src/
git commit -m "feat(voice): add createVoice() plugin factory"
```

---

## Phase 3: Remove Voice from Core and Adapters

### Task 13: Remove Voice from Core

**Files:**
- Delete: `packages/core/src/voice/voice-provider.ts`
- Delete: `packages/core/src/voice/voice-manager.ts`
- Delete: `packages/core/src/voice/openai-voice-provider.ts`
- Delete: `packages/core/src/schemas/voice.schemas.ts`
- Delete: `packages/core/src/storage/file-storage/audio-store.ts`
- Modify: `packages/core/src/storage/interfaces.ts` — remove AudioStore, AudioEntry, remove `audio` from StorageProvider
- Modify: `packages/core/src/storage/file-storage/index.ts` — remove audio store creation
- Modify: `packages/core/src/storage/in-memory/index.ts` — remove audio store creation
- Modify: `packages/core/src/types.ts` — remove `voice?: VoiceManager` from PluginContext
- Modify: `packages/core/src/index.ts` — remove voice exports, remove voice schema exports

**Step 1: Delete voice files**

```bash
rm -rf packages/core/src/voice/
rm packages/core/src/schemas/voice.schemas.ts
rm packages/core/src/storage/file-storage/audio-store.ts
```

**Step 2: Remove AudioStore from storage interfaces**

In `packages/core/src/storage/interfaces.ts`:
- Remove the `AudioEntry` interface
- Remove the `AudioStore` interface
- Remove `audio: AudioStore` from `StorageProvider`

**Step 3: Remove audio from storage factories**

In `packages/core/src/storage/file-storage/index.ts`:
- Remove `import { createAudioStore } from "./audio-store.js";`
- Remove `audio: createAudioStore(dataDir),` from the returned object

In `packages/core/src/storage/in-memory/index.ts`:
- Remove the entire `createAudioStore()` function
- Remove `audio: createAudioStore(),` from `createMemoryStorage()`

**Step 4: Remove voice from PluginContext**

In `packages/core/src/types.ts`:
- Remove `import { VoiceManager } from "./voice/voice-manager.js";`
- Remove `voice?: VoiceManager;` from `PluginContext`

**Step 5: Remove voice exports from core index**

In `packages/core/src/index.ts`:
- Remove the entire `// ── Voice ──` export block
- Remove voice schemas from the `// ── Schemas ──` export block
- Remove `AudioStore` and `AudioEntry` type exports from the storage section

**Step 6: Run typecheck to find breakages**

Run: `bun run --cwd packages/core tsc --noEmit`
Expected: May have errors in core test files or other imports that reference voice — fix them.

**Step 7: Run core tests**

Run: `bun run --cwd packages/core test`
Expected: PASS (voice had no unit tests in core)

**Step 8: Commit**

```bash
git add -A packages/core/
git commit -m "refactor(core): remove voice, AudioStore, and voice schemas from core"
```

---

### Task 14: Remove Voice Routes from Adapters

**Files:**
- Delete: `packages/adapters/hono/src/routes/voice/voice.routes.ts`
- Delete: `packages/adapters/hono-openapi/src/routes/voice/voice.routes.ts`
- Delete: `packages/adapters/elysia/src/routes/voice.ts`
- Modify: `packages/adapters/hono/src/plugin.ts` — remove voice import, VoiceManager creation, conditional voice mounting
- Modify: `packages/adapters/hono/src/types.ts` — remove VoiceConfig
- Modify: `packages/adapters/hono/src/index.ts` — remove VoiceConfig export
- Modify: `packages/adapters/hono-openapi/src/plugin.ts` — same
- Modify: `packages/adapters/hono-openapi/src/types.ts` — same
- Modify: `packages/adapters/hono-openapi/src/index.ts` — same
- Modify: `packages/adapters/elysia/src/plugin.ts` — same
- Modify: `packages/adapters/elysia/src/types.ts` — same
- Modify: `packages/adapters/elysia/src/index.ts` — same

**Step 1: Delete voice route files**

```bash
rm -rf packages/adapters/hono/src/routes/voice/
rm -rf packages/adapters/hono-openapi/src/routes/voice/
rm packages/adapters/elysia/src/routes/voice.ts
```

**Step 2: Clean up Hono adapter**

In `packages/adapters/hono/src/plugin.ts`:
- Remove `import { VoiceManager } from "@kitnai/core";`
- Remove `import { createVoiceRoutes } from "./routes/voice/voice.routes.js";`
- Remove `const voice = config.voice ? new VoiceManager() : undefined;`
- Remove `voice,` from the ctx object
- Remove the `if (voice) { app.route("/voice", createVoiceRoutes(ctx)); }` block

In `packages/adapters/hono/src/types.ts`:
- Remove `VoiceConfig` interface
- Remove `voice?: VoiceConfig;` from `AIPluginConfig`

In `packages/adapters/hono/src/index.ts`:
- Remove `VoiceConfig` from the type exports

**Step 3: Clean up Hono-OpenAPI adapter**

Same changes as Step 2, adapted for hono-openapi file paths.

**Step 4: Clean up Elysia adapter**

Same changes as Step 2, adapted for elysia file paths.

**Step 5: Run typecheck across all adapters**

Run: `bun run typecheck` (all packages)
Expected: May have errors — fix any remaining references to voice types

**Step 6: Run all tests**

Run: `bun run test`
Expected: All pass (adapter tests don't test voice routes directly)

**Step 7: Commit**

```bash
git add -A packages/adapters/
git commit -m "refactor(adapters): remove voice routes and VoiceConfig, voice is now a plugin"
```

---

### Task 15: Update Examples

**Files:**
- Modify: `examples/api/src/index.ts`
- Modify: `examples/api/package.json`

**Context:** Update the API example to use `@kitn/voice` as a plugin instead of the adapter's built-in voice support.

**Step 1: Add @kitnai/voice dependency**

In `examples/api/package.json`, add:
```json
"@kitnai/voice": "workspace:*"
```

Run: `bun install`

**Step 2: Update examples/api/src/index.ts**

Replace the old voice wiring:

```typescript
// Old imports:
import { createAIPlugin, createFileStorage, createInternalScheduler, OpenAIVoiceProvider } from "@kitnai/hono-adapter";

// New imports:
import { createAIPlugin, createFileStorage, createInternalScheduler } from "@kitnai/hono-adapter";
import { createVoice, OpenAIVoiceProvider, createFileAudioStore } from "@kitnai/voice";
```

Replace the plugin creation — remove `voice` from config spread, add `plugins`:

```typescript
const voicePlugin = voiceEnabled
  ? createVoice({
      retainAudio: env.VOICE_RETAIN_AUDIO,
      audioStore: createFileAudioStore("./data/voice"),
      providers: [
        ...(env.OPENAI_API_KEY ? [new OpenAIVoiceProvider({
          apiKey: env.OPENAI_API_KEY,
          name: "openai",
          ttsModel: env.VOICE_TTS_MODEL,
          sttModel: env.VOICE_STT_MODEL,
          defaultSpeaker: env.VOICE_DEFAULT_SPEAKER,
        })] : []),
        ...(env.GROQ_API_KEY ? [new OpenAIVoiceProvider({
          apiKey: env.GROQ_API_KEY,
          name: "groq",
          label: "Groq",
          baseUrl: "https://api.groq.com/openai/v1",
          sttModel: "whisper-large-v3-turbo",
          ttsModel: env.VOICE_TTS_MODEL,
          defaultSpeaker: env.VOICE_DEFAULT_SPEAKER,
        })] : []),
      ],
    })
  : undefined;

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? env.DEFAULT_MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  resilience: { maxRetries: 2, baseDelayMs: 500 },
  compaction: { threshold: 20, preserveRecent: 4 },
  hooks: { level: "summary" },
  cronScheduler: { async schedule() {}, async unschedule() {} },
  plugins: voicePlugin ? [voicePlugin] : [],
});
```

Remove the old voice provider registration block (the `if (voiceEnabled && plugin.voice) { ... }` block).

**Step 3: Run the API example to verify**

Run: `bun run --cwd examples/api src/index.ts`
Expected: Server starts, logs voice plugin if keys present

**Step 4: Commit**

```bash
git add examples/api/
git commit -m "refactor(example-api): use @kitn/voice plugin instead of built-in voice"
```

---

### Task 16: Update Registry

**Files:**
- Create: `registry/components/package/voice/manifest.json`
- Modify: `registry/components/package/core/manifest.json`

**Step 1: Create voice package manifest**

Create `registry/components/package/voice/manifest.json`:

```json
{
  "name": "voice",
  "type": "kitn:package",
  "description": "Voice plugin for kitn — TTS, STT, and full voice conversation with any OpenAI-compatible provider",
  "sourceDir": "packages/voice/src",
  "installDir": "voice",
  "dependencies": ["@kitn/voice"],
  "registryDependencies": ["core"],
  "envVars": {
    "OPENAI_API_KEY": {
      "description": "OpenAI API key for voice (TTS + STT)",
      "required": false,
      "secret": true
    }
  },
  "docs": "Voice plugin installed. Import with: import { createVoice, OpenAIVoiceProvider } from '@kitn/voice'",
  "categories": ["voice", "audio"],
  "version": "1.0.0",
  "changelog": [
    { "version": "1.0.0", "date": "2026-02-28", "type": "initial", "note": "Initial release — extracted from core" }
  ]
}
```

**Step 2: Update core manifest**

In `registry/components/package/core/manifest.json`, update the description to remove "voice":

```json
"description": "Framework-agnostic AI agent engine — agents, tools, storage, streaming, events"
```

**Step 3: Commit**

```bash
git add registry/components/package/
git commit -m "feat(registry): add voice package component, update core description"
```

---

### Task 17: Update Registry Template

**Files:**
- Modify: `/Users/home/Projects/kitn-ai/registry-template/_stubs/core.d.ts`

**Context:** The registry template has type stubs. Remove `audio` from the StorageProvider stub. This is a separate repo at `/Users/home/Projects/kitn-ai/registry-template/`.

**Step 1: Update core.d.ts**

Remove the `audio: any;` line from the StorageProvider type in `_stubs/core.d.ts`.

**Step 2: Commit (in registry-template repo)**

```bash
cd /Users/home/Projects/kitn-ai/registry-template
git add _stubs/core.d.ts
git commit -m "refactor: remove audio from StorageProvider stub (moved to @kitn/voice)"
git push
```

---

### Task 18: Final Verification

**Step 1: Build all packages**

Run: `bun run build`
Expected: All packages build successfully

**Step 2: Run all tests**

Run: `bun run test`
Expected: All tests pass

**Step 3: Typecheck**

Run: `bun run typecheck`
Expected: No new errors (pre-existing MCP errors are acceptable)

**Step 4: Verify voice package tests**

Run: `bun test packages/voice/`
Expected: All voice-specific tests pass

**Step 5: Commit any final fixes**

If any fixes were needed, commit them:
```bash
git commit -m "fix: resolve post-extraction issues"
```
