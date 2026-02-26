import type { MemoryStore, MemoryEntry } from "../interfaces.js";

/**
 * Creates an in-memory (Map-based) implementation of MemoryStore.
 * All data lives in process memory and is lost on restart.
 * Useful as the default backing store for the built-in _memory tool.
 */
export function createInMemoryMemoryStore(): MemoryStore {
  // internal key -> (entry key -> entry)
  // Internal keys are either plain namespace IDs or "{scopeId}:{namespaceId}"
  const store = new Map<string, Map<string, MemoryEntry>>();

  function internalKey(namespaceId: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${namespaceId}` : namespaceId;
  }

  function getNamespace(namespaceId: string, scopeId?: string): Map<string, MemoryEntry> {
    const key = internalKey(namespaceId, scopeId);
    let ns = store.get(key);
    if (!ns) {
      ns = new Map();
      store.set(key, ns);
    }
    return ns;
  }

  /** Extract the user-facing namespace name from an internal key. */
  function parseInternalKey(key: string): { namespaceId: string; scopeId?: string } {
    const colonIdx = key.indexOf(":");
    if (colonIdx === -1) return { namespaceId: key };
    return { scopeId: key.slice(0, colonIdx), namespaceId: key.slice(colonIdx + 1) };
  }

  return {
    async listNamespaces(scopeId?) {
      const namespaces: string[] = [];
      for (const [key, entries] of store) {
        if (entries.size === 0) continue;
        const parsed = parseInternalKey(key);
        if (scopeId) {
          if (parsed.scopeId === scopeId) namespaces.push(parsed.namespaceId);
        } else {
          namespaces.push(parsed.namespaceId);
        }
      }
      // Deduplicate namespace names when returning all (unscoped + scoped may share names)
      return scopeId ? namespaces : [...new Set(namespaces)];
    },

    async listEntries(namespaceId: string, scopeId?) {
      if (scopeId) {
        const ns = store.get(internalKey(namespaceId, scopeId));
        return ns ? [...ns.values()] : [];
      }
      // Without scopeId, return entries from all scopes for this namespace
      const results: MemoryEntry[] = [];
      for (const [key, ns] of store) {
        const parsed = parseInternalKey(key);
        if (parsed.namespaceId === namespaceId) {
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
      return store.get(internalKey(namespaceId, scopeId))?.get(key) ?? null;
    },

    async deleteEntry(namespaceId: string, key: string, scopeId?) {
      const ns = store.get(internalKey(namespaceId, scopeId));
      if (!ns) return false;
      return ns.delete(key);
    },

    async clearNamespace(namespaceId: string, scopeId?) {
      store.delete(internalKey(namespaceId, scopeId));
    },

    async loadMemoriesForIds(ids: string[], scopeId?) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      for (const id of ids) {
        if (scopeId) {
          const ns = store.get(internalKey(id, scopeId));
          if (!ns) continue;
          for (const entry of ns.values()) {
            results.push({ ...entry, namespace: id });
          }
        } else {
          // Without scopeId, collect from all scopes for this namespace
          for (const [key, ns] of store) {
            const parsed = parseInternalKey(key);
            if (parsed.namespaceId === id) {
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
