# Plugin System & Voice Extraction Design

## Goal

Introduce a generic plugin system so that optional features (voice, webhooks, etc.) can define their APIs once and work across all framework adapters automatically. Extract voice from core as the first plugin built on this system.

## Problem

Each optional feature (voice, crons, jobs) currently requires hand-written routes in every adapter (Hono, Hono-OpenAPI, Elysia). This creates an N×M scaling problem: every new feature multiplies by every adapter, and every new adapter multiplies by every feature. The plugin system solves this by having features define routes once against a standard interface, and each adapter translate them generically.

## Architecture

Two deliverables:

1. **Plugin system** — generic infrastructure in core + adapters
2. **Voice extraction** — voice moves from core to `packages/voice/` as the first plugin

### Plugin Interface (Core)

```typescript
interface KitnPlugin {
  name: string;         // "voice", "webhooks", etc.
  prefix: string;       // "/voice", "/webhooks" — mounted under the API base
  routes: PluginRoute[];
  init?: (ctx: PluginContext) => void | Promise<void>;
}

interface PluginRoute {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;         // e.g. "/speakers", "/speak"
  handler: (ctx: PluginHandlerContext) => Promise<Response>;
  schema?: PluginRouteSchema;
}

interface PluginHandlerContext {
  request: Request;               // standard Web API Request
  params: Record<string, string>; // route params
  pluginContext: PluginContext;    // access to agents, storage, model, hooks
}

interface PluginRouteSchema {
  summary?: string;
  description?: string;
  tags?: string[];
  body?: { content: Record<string, { schema: ZodSchema }> };
  query?: ZodSchema;
  params?: ZodSchema;
  responses?: Record<number, {
    description: string;
    content?: Record<string, { schema: ZodSchema }>;
  }>;
}
```

Handlers return standard `Response` objects (`Response.json()`, `new Response(stream)`, etc.). This works because Hono, Elysia, and all modern frameworks are built on Web Standard Request/Response.

The optional `schema` field carries OpenAPI metadata. Plain Hono and Elysia adapters ignore it. The Hono-OpenAPI adapter uses it to auto-generate documentation.

The `init` function runs after the plugin factory is fully constructed, giving the plugin access to PluginContext for subscribing to lifecycle hooks or accessing shared resources.

### Plugin Config

```typescript
const plugin = createAIPlugin({
  model: ...,
  storage: ...,
  plugins: [
    createVoice({ ... }),
    // future: createWebhooks({ ... })
  ],
});
```

`CoreConfig` gains `plugins?: KitnPlugin[]`.

### Adapter Translation Layer

Each adapter gets a one-time generic `mountPlugin()` function:

**Hono:**
```typescript
function mountPlugin(app: Hono, plugin: KitnPlugin, ctx: PluginContext) {
  const sub = new Hono();
  for (const route of plugin.routes) {
    sub[route.method.toLowerCase()](route.path, async (c) => {
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

**Hono-OpenAPI:** Same pattern, but reads `route.schema` to generate OpenAPI specs via `createRoute()`.

**Elysia:** Same pattern translated to Elysia's API.

This function is written once per framework and works for all plugins.

### Discovery Endpoint

Auto-mounted by each plugin factory:

```
GET /api/plugins
→ [
    { name: "voice", prefix: "/voice", routes: [{ method: "GET", path: "/speakers" }, ...] }
  ]
```

## Voice Plugin (`packages/voice/`)

Published as `@kitn/voice`. Fully self-contained — owns its providers, storage, routes, and schemas.

### User-Facing API

```typescript
import { createVoice, OpenAIVoiceProvider } from "@kitn/voice";

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  plugins: [
    createVoice({
      retainAudio: true,
      providers: [
        new OpenAIVoiceProvider({ apiKey: env.OPENAI_API_KEY }),
        new OpenAIVoiceProvider({
          apiKey: env.GROQ_API_KEY,
          name: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          sttModel: "whisper-large-v3-turbo",
        }),
      ],
    }),
  ],
});
```

### What Moves to `packages/voice/`

- `VoiceManager` class
- `VoiceProvider` interface + related types (TranscribeOptions, SpeakOptions, VoiceSpeaker, etc.)
- `OpenAIVoiceProvider` implementation
- `AudioStore` interface + in-memory and file-based implementations
- Voice Zod schemas (speakRequestSchema, transcribeResponseSchema, etc.)
- Voice route handlers (transcribe, speak, converse, speakers, providers, audio CRUD)

### What Gets Removed from Core

- `packages/core/src/voice/` directory (VoiceManager, VoiceProvider, OpenAIVoiceProvider)
- `AudioStore` interface and implementations from StorageProvider
- `voice?: VoiceManager` from PluginContext
- Voice Zod schemas from `packages/core/src/schemas/`
- Voice-related exports from `packages/core/src/index.ts`

### AudioStore

Voice owns its own AudioStore. Defaults to in-memory, with an override for custom backends:

```typescript
// Simple (in-memory default)
createVoice({ providers: [...] })

// Custom storage backend
createVoice({
  providers: [...],
  audioStore: createFileAudioStore("./data/voice"),
})
```

The voice package exports `createFileAudioStore()` and `createMemoryAudioStore()`. Users can also implement the `AudioStore` interface for S3, R2, Postgres, etc.

### Routes (7 endpoints, unchanged)

| Method | Path | Description |
|--------|------|-------------|
| GET | /speakers | List speakers for default provider |
| GET | /providers | List all registered providers |
| POST | /transcribe | STT (multipart upload) |
| POST | /speak | TTS (returns streaming audio) |
| POST | /converse | Transcribe → run agent → speak (round-trip) |
| GET | /audio | List saved audio entries |
| GET | /audio/:id | Retrieve saved audio |
| DELETE | /audio/:id | Delete saved audio |

The `/converse` route accesses `PluginContext` (via `PluginHandlerContext.pluginContext`) to run agents.

## Registry

Voice becomes a `kitn:package` registry component at `registry/components/package/voice/`, allowing users to `kitn add voice`. The registry entry includes `@kitn/voice` as an npm dependency and documents the required env vars (`OPENAI_API_KEY`, etc.).

The core package's registry manifest (`registry/components/package/core/manifest.json`) should be updated to remove voice from its description since voice is no longer part of core.

### Registry Template (`kitn-ai/registry-template`)

The registry template repo at `/Users/home/Projects/kitn-ai/registry-template/` needs updates:
- `_stubs/core.d.ts` — remove `audio` from StorageProvider, add KitnPlugin types
- May need a `plugin` component type or a way for registry components to declare themselves as plugins

## Changes to Existing Code

### Core
- Remove voice directory, AudioStore, voice schemas, voice exports
- Add KitnPlugin interface and related types
- Add `plugins?: KitnPlugin[]` to CoreConfig

### Adapters (Hono, Hono-OpenAPI, Elysia)
- Remove voice route files
- Remove VoiceConfig from AIPluginConfig
- Remove conditional voice mounting from plugin.ts
- Add generic `mountPlugin()` function (one-time per adapter)
- Add plugin loop in plugin.ts: iterate config.plugins, mount each, call init()
- Add GET /plugins discovery endpoint

### Examples
- `examples/api/` — import from `@kitn/voice` instead of adapter
- `examples/voice/` — same import change

### Client (`packages/client/`)
- No change. Browser-side audio utilities are independent.

## File Map

### New Files
- `packages/core/src/plugins/types.ts` — KitnPlugin, PluginRoute, PluginHandlerContext, PluginRouteSchema
- `packages/core/src/plugins/index.ts` — barrel exports
- `packages/voice/package.json`
- `packages/voice/tsconfig.json`
- `packages/voice/src/index.ts` — public API exports
- `packages/voice/src/voice-manager.ts` — moved from core
- `packages/voice/src/voice-provider.ts` — moved from core
- `packages/voice/src/openai-voice-provider.ts` — moved from core
- `packages/voice/src/audio-store.ts` — AudioStore interface
- `packages/voice/src/audio-store-memory.ts` — in-memory implementation
- `packages/voice/src/audio-store-file.ts` — file-based implementation
- `packages/voice/src/schemas.ts` — voice Zod schemas
- `packages/voice/src/routes.ts` — route definitions (standard handlers)
- `packages/voice/src/plugin.ts` — createVoice() factory

### New Registry Files
- `registry/components/package/voice/manifest.json` — voice package registry component

### Modified Files
- `registry/components/package/core/manifest.json` — remove voice from description
- `packages/core/src/types.ts` — remove voice from PluginContext, add plugins to CoreConfig
- `packages/core/src/storage/interfaces.ts` — remove AudioStore, AudioEntry from StorageProvider
- `packages/core/src/storage/file-storage/index.ts` — remove audio store creation
- `packages/core/src/storage/in-memory/index.ts` — remove audio store creation
- `packages/core/src/index.ts` — remove voice exports, add plugin type exports
- `packages/adapters/hono/src/plugin.ts` — remove voice mounting, add generic mountPlugin loop
- `packages/adapters/hono/src/types.ts` — remove VoiceConfig
- `packages/adapters/hono-openapi/src/plugin.ts` — same
- `packages/adapters/hono-openapi/src/types.ts` — same
- `packages/adapters/elysia/src/plugin.ts` — same
- `packages/adapters/elysia/src/types.ts` — same
- `examples/api/src/index.ts` — use @kitn/voice
- `examples/voice/src/lib/api.ts` — no server-side changes needed (client only)

### Deleted Files
- `packages/core/src/voice/voice-provider.ts`
- `packages/core/src/voice/voice-manager.ts`
- `packages/core/src/voice/openai-voice-provider.ts`
- `packages/core/src/schemas/voice.schemas.ts`
- `packages/core/src/storage/file-storage/audio-store.ts`
- `packages/adapters/hono/src/routes/voice/voice.routes.ts`
- `packages/adapters/hono-openapi/src/routes/voice/voice.routes.ts`
- `packages/adapters/elysia/src/routes/voice.ts`

## Future Implications

Once this system exists, future features follow the same pattern:
- Webhooks: `createWebhooks({ ... })` → KitnPlugin
- Rate limiting: `createRateLimiter({ ... })` → KitnPlugin
- Any new feature defines its routes once, works across all adapters
- Any new adapter implements `mountPlugin()` once, supports all plugins
