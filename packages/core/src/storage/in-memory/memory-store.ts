import type { MemoryStore, MemoryEntry } from "../interfaces.js";

/**
 * Creates an in-memory (Map-based) implementation of MemoryStore.
 * All data lives in process memory and is lost on restart.
 * Useful as the default backing store for the built-in _memory tool.
 */
export function createInMemoryMemoryStore(): MemoryStore {
  // internal key -> (entry key -> entry)
  // Internal keys use \0 as separator: "{namespaceId}\0{scopeId}" or plain namespaceId
  const store = new Map<string, Map<string, MemoryEntry>>();
  /** Maps scopeId -> Set of internal store keys that belong to that scope */
  const scopeIndex = new Map<string, Set<string>>();

  function storeKey(namespaceId: string, scopeId?: string): string {
    return scopeId ? `${namespaceId}\0${scopeId}` : namespaceId;
  }

  function trackScope(key: string, scopeId?: string): void {
    if (!scopeId) return;
    let set = scopeIndex.get(scopeId);
    if (!set) { set = new Set(); scopeIndex.set(scopeId, set); }
    set.add(key);
  }

  function untrackScope(key: string, scopeId?: string): void {
    if (!scopeId) return;
    scopeIndex.get(scopeId)?.delete(key);
  }

  /** Extract the user-facing namespace name from an internal key. */
  function namespaceFromKey(key: string): string {
    const idx = key.indexOf("\0");
    return idx === -1 ? key : key.slice(0, idx);
  }

  function getNamespace(namespaceId: string, scopeId?: string): Map<string, MemoryEntry> {
    const key = storeKey(namespaceId, scopeId);
    let ns = store.get(key);
    if (!ns) {
      ns = new Map();
      store.set(key, ns);
      trackScope(key, scopeId);
    }
    return ns;
  }

  return {
    async listNamespaces(scopeId?) {
      if (scopeId) {
        const keys = scopeIndex.get(scopeId);
        if (!keys) return [];
        const namespaces: string[] = [];
        for (const key of keys) {
          const ns = store.get(key);
          if (ns && ns.size > 0) namespaces.push(namespaceFromKey(key));
        }
        return namespaces;
      }
      // Without scopeId: return all unique namespaces
      const namespaces = new Set<string>();
      for (const [key, entries] of store) {
        if (entries.size === 0) continue;
        namespaces.add(namespaceFromKey(key));
      }
      return [...namespaces];
    },

    async listEntries(namespaceId: string, scopeId?) {
      if (scopeId) {
        const ns = store.get(storeKey(namespaceId, scopeId));
        return ns ? [...ns.values()] : [];
      }
      // Without scopeId, return entries from all scopes for this namespace
      const results: MemoryEntry[] = [];
      for (const [key, ns] of store) {
        if (namespaceFromKey(key) === namespaceId) {
          results.push(...ns.values());
        }
      }
      return results;
    },

    async saveEntry(namespaceId: string, key: string, value: string, context?: string, scopeId?) {
      const ns = getNamespace(namespaceId, scopeId);
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

    async getEntry(namespaceId: string, key: string, scopeId?) {
      return store.get(storeKey(namespaceId, scopeId))?.get(key) ?? null;
    },

    async deleteEntry(namespaceId: string, key: string, scopeId?) {
      const ns = store.get(storeKey(namespaceId, scopeId));
      if (!ns) return false;
      return ns.delete(key);
    },

    async clearNamespace(namespaceId: string, scopeId?) {
      const key = storeKey(namespaceId, scopeId);
      store.delete(key);
      untrackScope(key, scopeId);
    },

    async loadMemoriesForIds(ids: string[], scopeId?) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      for (const id of ids) {
        if (scopeId) {
          const ns = store.get(storeKey(id, scopeId));
          if (!ns) continue;
          for (const entry of ns.values()) {
            results.push({ ...entry, namespace: id });
          }
        } else {
          // Without scopeId, collect from all scopes for this namespace
          for (const [key, ns] of store) {
            if (namespaceFromKey(key) === id) {
              for (const entry of ns.values()) {
                results.push({ ...entry, namespace: id });
              }
            }
          }
        }
      }
      return results;
    },
  };
}
