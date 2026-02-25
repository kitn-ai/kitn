---
name: add-storage-provider
description: Add a new storage provider backend to @kitnai/core
---

# Add a Storage Provider

Follow these steps to add a new storage backend to `@kitnai/core`.

## 1. Create provider directory

Create `packages/core/src/storage/<provider-name>/`.

## 2. Implement all 6 sub-stores

Each sub-store must implement its interface from `packages/core/src/storage/interfaces.ts`:

| File | Interface | Purpose |
|------|-----------|---------|
| `conversation-store.ts` | `ConversationStore` | Multi-turn conversation history |
| `memory-store.ts` | `MemoryStore` | Namespaced key-value memory |
| `skill-store.ts` | `SkillStore` | Behavioral skill definitions with YAML frontmatter |
| `task-store.ts` | `TaskStore` | Simple task/todo tracking |
| `prompt-store.ts` | `PromptStore` | Agent system prompt overrides |
| `audio-store.ts` | `AudioStore` | Audio file storage for voice subsystem |

### Key interface contracts

- `get()` methods return `null` when not found (never throw)
- `delete()` methods return `boolean` indicating whether the item existed
- Namespaces/conversations are auto-created on first write
- `SkillStore` must parse YAML frontmatter from markdown content
- `AudioStore.cleanupOlderThan()` returns count of deleted entries

## 3. Create index.ts with factory function

```ts
import type { StorageProvider } from "../interfaces.js";
// Import all sub-store implementations...

export interface <Provider>StorageOptions {
  // Provider-specific configuration
}

export function create<Provider>Storage(options: <Provider>StorageOptions): StorageProvider {
  return {
    conversations: new <Provider>ConversationStore(options),
    memory: new <Provider>MemoryStore(options),
    skills: new <Provider>SkillStore(options),
    tasks: new <Provider>TaskStore(options),
    prompts: new <Provider>PromptStore(options),
    audio: new <Provider>AudioStore(options),
  };
}
```

## 4. Export from package

Add to `packages/core/src/index.ts`:

```ts
export { create<Provider>Storage } from "./storage/<provider-name>/index.js";
export type { <Provider>StorageOptions } from "./storage/<provider-name>/index.js";
```

## 5. Add tests

Create `packages/core/test/storage/<provider-name>.test.ts` testing each sub-store.

## 6. Verify

```bash
bun run --cwd packages/core typecheck
bun run --cwd packages/core test
```

## Reference files

- All 6 interfaces with JSDoc: `packages/core/src/storage/interfaces.ts`
- Full file-based implementation (7 files): `packages/core/src/storage/file-storage/`
- Minimal in-memory implementation (2 files): `packages/core/src/storage/in-memory/`
