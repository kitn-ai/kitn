import { tool } from "ai";
import { z } from "zod";
import type { MemoryStore } from "../storage/interfaces.js";
import { createInMemoryMemoryStore } from "../storage/in-memory/memory-store.js";

let defaultStore: MemoryStore | null = null;

/** Returns the singleton default MemoryStore, lazy-creating an in-memory store on first call. */
export function getDefaultMemoryStore(): MemoryStore {
  if (!defaultStore) {
    defaultStore = createInMemoryMemoryStore();
  }
  return defaultStore;
}

/** Replaces the default MemoryStore (called by plugin.ts when config.memoryStore is provided). */
export function setDefaultMemoryStore(store: MemoryStore): void {
  defaultStore = store;
}

const memoryInputSchema = z.object({
  action: z.enum(["get", "set", "list", "delete"]),
  key: z.string().optional().describe("Required for get, set, and delete actions"),
  value: z.string().optional().describe("Required for set action — the value to store"),
  context: z.string().optional().describe("Optional context about why this was stored (set action only)"),
  namespace: z.string().optional().describe("Override the default namespace"),
});

/**
 * Creates the built-in `_memory` tool bound to a specific store and default namespace.
 * The namespace defaults to the agent name but can be overridden per-call.
 */
export function createMemoryTool(store: MemoryStore, defaultNamespace: string) {
  return tool({
    description:
      "Store and retrieve information across conversations. " +
      "Actions: set (save key-value), get (retrieve by key), list (show all entries), delete (remove by key). " +
      "Use to remember user preferences, intermediate results, or important facts.",
    inputSchema: memoryInputSchema,
    execute: async (input) => {
      const ns = input.namespace ?? defaultNamespace;

      switch (input.action) {
        case "get": {
          const key = input.key ?? "";
          const entry = await store.getEntry(ns, key);
          if (!entry) return { found: false, key, namespace: ns };
          return { found: true, key: entry.key, value: entry.value, context: entry.context, namespace: ns };
        }
        case "set": {
          const key = input.key ?? "";
          const value = input.value ?? "";
          const entry = await store.saveEntry(ns, key, value, input.context);
          return { saved: true, key: entry.key, namespace: ns };
        }
        case "list": {
          const entries = await store.listEntries(ns);
          return {
            namespace: ns,
            count: entries.length,
            entries: entries.map((e) => ({ key: e.key, value: e.value, context: e.context })),
          };
        }
        case "delete": {
          const key = input.key ?? "";
          const deleted = await store.deleteEntry(ns, key);
          return { deleted, key, namespace: ns };
        }
        default: {
          const _exhaustive: never = input.action;
          return { error: `Unknown action: ${_exhaustive}` };
        }
      }
    },
  });
}
