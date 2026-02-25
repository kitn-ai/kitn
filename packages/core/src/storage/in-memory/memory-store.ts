import type { MemoryStore, MemoryEntry } from "../interfaces.js";

/**
 * Creates an in-memory (Map-based) implementation of MemoryStore.
 * All data lives in process memory and is lost on restart.
 * Useful as the default backing store for the built-in _memory tool.
 */
export function createInMemoryMemoryStore(): MemoryStore {
  // namespace -> (key -> entry)
  const store = new Map<string, Map<string, MemoryEntry>>();

  function getNamespace(id: string): Map<string, MemoryEntry> {
    let ns = store.get(id);
    if (!ns) {
      ns = new Map();
      store.set(id, ns);
    }
    return ns;
  }

  return {
    async listNamespaces() {
      const namespaces: string[] = [];
      for (const [id, entries] of store) {
        if (entries.size > 0) namespaces.push(id);
      }
      return namespaces;
    },

    async listEntries(namespaceId: string) {
      const ns = store.get(namespaceId);
      return ns ? [...ns.values()] : [];
    },

    async saveEntry(namespaceId: string, key: string, value: string, context?: string) {
      const ns = getNamespace(namespaceId);
      const existing = ns.get(key);
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        key,
        value,
        context: context ?? "",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      ns.set(key, entry);
      return entry;
    },

    async getEntry(namespaceId: string, key: string) {
      return store.get(namespaceId)?.get(key) ?? null;
    },

    async deleteEntry(namespaceId: string, key: string) {
      const ns = store.get(namespaceId);
      if (!ns) return false;
      return ns.delete(key);
    },

    async clearNamespace(namespaceId: string) {
      store.delete(namespaceId);
    },

    async loadMemoriesForIds(ids: string[]) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      for (const id of ids) {
        const ns = store.get(id);
        if (!ns) continue;
        for (const entry of ns.values()) {
          results.push({ ...entry, namespace: id });
        }
      }
      return results;
    },
  };
}
