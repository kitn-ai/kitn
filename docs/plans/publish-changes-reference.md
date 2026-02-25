# Publish Changes — Exact Reference

This document contains the exact before/after for every file change in the publish plan. Claude Code should use this as the source of truth.

---

## 1. `packages/client/tsconfig.json`

### BEFORE (current):
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

### AFTER:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

**Why:** `noEmit` and `allowImportingTsExtensions` block `tsc` from producing output. `verbatimModuleSyntax` conflicts with some re-export patterns. The linting options are nice-to-have but not needed for the build. `outDir`/`declaration` enable library output.

---

## 2. `packages/client/src/index.ts`

### BEFORE (current):
```ts
export { type SseEvent, parseSseStream } from "./sse-parser.ts";
export { splitIntoChunks, chunkedSpeak } from "./chunked-speak.ts";
export { AudioScheduler } from "./audio-scheduler.ts";
export { AudioRecorder } from "./audio-recorder.ts";
```

### AFTER:
```ts
export { type SseEvent, parseSseStream } from "./sse-parser.js";
export { splitIntoChunks, chunkedSpeak } from "./chunked-speak.js";
export { AudioScheduler } from "./audio-scheduler.js";
export { AudioRecorder } from "./audio-recorder.js";
```

**Why:** `tsc` emit requires `.js` extensions in import specifiers (they resolve to `.ts` files during compilation but the output `.js` files need `.js` extensions).

---

## 3. `packages/client/package.json`

### BEFORE (current):
```json
{
  "name": "@kitnai/client",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3"
  }
}
```

### AFTER:
```json
{
  "name": "@kitnai/client",
  "version": "0.1.0",
  "type": "module",
  "description": "Client utilities for kitn AI agents — SSE parser, audio recorder, chunked TTS",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kitn-ai/kitn",
    "directory": "packages/client"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run build"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3"
  }
}
```

**What changed:**
- `main` → `./dist/index.js`
- `types` → `./dist/index.d.ts`
- `exports` → conditional with `types` + `import`
- Added `files: ["dist"]` — only ship compiled output
- Added `publishConfig` — scoped packages need `access: "public"`
- Added `build` script (`tsc`) and `prepublishOnly`
- Added `description`, `license`, `repository`

---

## 4. `packages/server/package.json`

### BEFORE (current):
```json
{
  "name": "@kitnai/server",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@hono/zod-openapi": "^1.2.2",
    "ai": "^6.0.91",
    "hono": "^4.11.10",
    "zod": "^4.3.6"
  },
  "dependencies": {
    "@scalar/hono-api-reference": "^0.9.41"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3",
    "@hono/zod-openapi": "^1.2.2",
    "ai": "^6.0.91",
    "hono": "^4.11.10",
    "zod": "^4.3.6"
  }
}
```

### AFTER:
```json
{
  "name": "@kitnai/server",
  "version": "0.1.0",
  "type": "module",
  "description": "Server framework for kitn AI agents — Hono + Vercel AI SDK v6",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kitn-ai/kitn",
    "directory": "packages/server"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run build"
  },
  "peerDependencies": {
    "@hono/zod-openapi": "^1.2.2",
    "ai": "^6.0.91",
    "hono": "^4.11.10",
    "zod": "^4.3.6"
  },
  "dependencies": {
    "@scalar/hono-api-reference": "^0.9.41"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3",
    "@hono/zod-openapi": "^1.2.2",
    "ai": "^6.0.91",
    "hono": "^4.11.10",
    "zod": "^4.3.6"
  }
}
```

**What changed:**
- `main` → `./dist/index.js`
- `types` → `./dist/index.d.ts`
- `exports` → conditional with `types` + `import`
- Added `files: ["dist"]`
- Added `publishConfig`
- Added `build: "tsc"` script and `prepublishOnly`
- Added `description`, `license`, `repository`
- Kept `peerDependencies` and `devDependencies` as-is (peer deps pattern is correct for a framework)

**Note:** The server tsconfig already has `outDir: "dist"`, `declaration: true`, etc. and `tsc` compiles clean. No tsconfig changes needed.

---

## 5. `packages/cli/package.json`

### BEFORE (current):
```json
{
  "name": "@kitnai/cli",
  "version": "0.1.0",
  "type": "module",
  "description": "CLI for installing AI agent components from the kitn registry",
  "bin": {
    "kitn": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "dev": "tsup --watch",
    "build": "tsup",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run build"
  },
  "dependencies": { ... },
  "devDependencies": { ... },
  "keywords": ["ai", "agents", "cli", "registry", "kitn"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kitn-ai/kitn",
    "directory": "packages/cli"
  }
}
```

### AFTER — add only this field:
```json
  "publishConfig": {
    "access": "public"
  },
```

Insert after `"files": ["dist"],` — that's the only change needed. Everything else is already set up.

---

## 6. `packages/cli/src/commands/init.ts`

### Line 78 — BEFORE:
```ts
      "@kitn": "https://kitn.dev/r/{type}/{name}.json",
```

### Line 78 — AFTER:
```ts
      "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
```

**Why:** `kitn.dev` DNS is not configured yet. GitHub Pages at `kitn-ai.github.io/kitn/` is available immediately.

---

## 7. `.npmrc` (new file at repo root)

```
access=public
```

---

## 8. `.github/workflows/deploy-registry.yml` (new file)

```yaml
name: Deploy Registry to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'registry/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install

      - name: Build registry
        run: bun run build:registry

      - name: Prepare Pages artifact
        run: |
          mkdir -p _site/r
          cp -r registry/r/* _site/r/

      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**How it works:**
1. On push to `main` (if `registry/` changed) or manual trigger
2. Installs bun, runs `bun install`, builds registry JSON from component sources
3. Copies `registry/r/` into `_site/r/` (GitHub Pages artifact)
4. Deploys to GitHub Pages

**Deployed structure:**
```
https://kitn-ai.github.io/kitn/r/registry.json
https://kitn-ai.github.io/kitn/r/agents/weather-agent.json
https://kitn-ai.github.io/kitn/r/tools/weather-tool.json
...
```

---

## Verification Checklist

After all changes are made, run these in order:

```bash
# 1. Client build
bun run --cwd packages/client build
ls packages/client/dist/  # Should have index.js, index.d.ts, etc.

# 2. Server build
bun run --cwd packages/server build
ls packages/server/dist/  # Should have index.js, index.d.ts, agents/, lib/, etc.

# 3. CLI build
bun run --cwd packages/cli build
ls packages/cli/dist/     # Should have index.js with shebang

# 4. All tests still pass
bun test

# 5. Dry-run pack (verify only dist/ included)
cd packages/client && npm pack --dry-run && cd ../..
cd packages/server && npm pack --dry-run && cd ../..
cd packages/cli && npm pack --dry-run && cd ../..
```
