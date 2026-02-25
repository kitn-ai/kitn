# Publish Packages, Registry, and CLI

**Date:** 2026-02-24
**Status:** Ready to execute
**Branch:** Create `publish-packages` from `main`

## Goal

Make all three npm packages publishable and set up GitHub Pages for the component registry:

1. `@kitnai/client` — browser utilities (SSE parser, audio recorder, chunked TTS)
2. `@kitnai/server` — Hono + AI SDK v6 framework
3. `@kitnai/cli` — component installer CLI
4. Registry — static JSON served via GitHub Pages at `kitn-ai.github.io/kitn/`

## Current State (verified 2026-02-24)

- **All 153 tests pass** (`bun test`)
- **Server `tsc` compiles clean** — produces `.js` + `.d.ts` in dist/
- **Client `tsc --noEmit` passes** — but emit is disabled (`noEmit: true`, `allowImportingTsExtensions: true`)
- **CLI builds via tsup** — produces `dist/index.js` with shebang
- **Git is clean** on `main`, remote is `git@github.com:kitn-ai/kitn.git`
- **No `.npmrc`** at root
- **No `.github/workflows/`** directory
- **CLI default registry URL** is `https://kitn.dev/r/{type}/{name}.json` (needs to change to GitHub Pages URL until custom domain is set up)

## Prompt for Claude Code

When you open Claude Code in `~/Projects/kitn-ai/kitn`, use this prompt:

```
Implement the plan in docs/plans/publish-packages-registry-cli.md

The detailed changes for each step are in docs/plans/publish-changes-reference.md
```

---

## Steps

### Step 1: Make @kitnai/client publishable

The client currently has `noEmit: true` and `allowImportingTsExtensions: true` in its tsconfig — it can't produce `.js` output. The `index.ts` uses `.ts` extensions in imports which blocks `tsc` emit.

**Changes needed** (see reference doc for exact before/after):

1. **`packages/client/tsconfig.json`** — Remove `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`. Add `rootDir`, `outDir`, `declaration`, `declarationMap`, `sourceMap`.
2. **`packages/client/src/index.ts`** — Change 4 `.ts` import extensions to `.js`
3. **`packages/client/package.json`** — Add `main`, `types`, `exports` pointing to `dist/`. Add `files`, `publishConfig`, `build` script, `description`, `license`, `repository`.

**Verify:** `bun run --cwd packages/client build` produces `dist/` with `.js` + `.d.ts` files (5 modules).

### Step 2: Make @kitnai/server publishable

Server tsconfig already has `outDir`, `declaration`, etc. and compiles clean. Just needs package.json updates.

**Changes needed:**

1. **`packages/server/package.json`** — Change `main` and `types` from `src/index.ts` to `dist/index.js` and `dist/index.d.ts`. Update `exports`. Add `files`, `publishConfig`, `build` script, `description`, `license`, `repository`.

**Verify:** `bun run --cwd packages/server build` produces `dist/` with `.js` + `.d.ts` files.

### Step 3: Make @kitnai/cli publishable

CLI already has `bin`, `files: ["dist"]`, `build` script, and `prepublishOnly`. Just needs `publishConfig`.

**Changes needed:**

1. **`packages/cli/package.json`** — Add `publishConfig: { "access": "public" }`

**Verify:** `bun run --cwd packages/cli build` produces `dist/index.js` with shebang.

### Step 4: Add root .npmrc

**Create:** `.npmrc` with `access=public`

### Step 5: Update CLI default registry URL

Until `kitn.dev` DNS is configured, use the GitHub Pages URL.

**Changes needed:**

1. **`packages/cli/src/commands/init.ts`** line 78 — Change `"https://kitn.dev/r/{type}/{name}.json"` to `"https://kitn-ai.github.io/kitn/r/{type}/{name}.json"`

**Rebuild CLI after this change.**

### Step 6: Create GitHub Pages deploy workflow

**Create:** `.github/workflows/deploy-registry.yml`

This workflow:
- Triggers on pushes to `main` that change `registry/**` files, plus manual dispatch
- Installs bun, runs `bun install`, runs `bun run build:registry`
- Deploys the `registry/r/` directory to GitHub Pages under an `/r/` prefix
- The deployed structure serves files at `https://kitn-ai.github.io/kitn/r/...`

See reference doc for the full workflow YAML.

### Step 7: Dry-run all packages

```bash
cd packages/client && npm pack --dry-run
cd ../server && npm pack --dry-run
cd ../cli && npm pack --dry-run
```

Verify each only includes `dist/` files.

### Step 8: Run all tests

```bash
bun test
```

All 153 tests should still pass.

### Step 9: Commit and push

Commit all changes on the `publish-packages` branch, push, and create a PR to `main`.

---

## Manual steps (user, after PR is merged)

1. **Enable GitHub Pages** in repo settings: Settings → Pages → Source: GitHub Actions
2. **npm login** with `@kitnai` org access
3. **Publish packages** (in order):
   ```bash
   cd packages/client && npm publish
   cd ../server && npm publish
   cd ../cli && npm publish
   ```
4. **Verify end-to-end:**
   ```bash
   mkdir /tmp/kitn-test && cd /tmp/kitn-test
   npm init -y
   npx @kitnai/cli init
   npx @kitnai/cli list
   npx @kitnai/cli add weather-agent
   ```

## Files to modify

| File | Change |
|------|--------|
| `packages/client/tsconfig.json` | Enable emit, add outDir/declaration |
| `packages/client/src/index.ts` | `.ts` → `.js` import extensions |
| `packages/client/package.json` | dist paths, files, publishConfig, build |
| `packages/server/package.json` | dist paths, files, publishConfig, build |
| `packages/cli/package.json` | Add publishConfig |
| `packages/cli/src/commands/init.ts` | Update default registry URL |
| `.npmrc` | **New** — `access=public` |
| `.github/workflows/deploy-registry.yml` | **New** — GitHub Pages deployment |
