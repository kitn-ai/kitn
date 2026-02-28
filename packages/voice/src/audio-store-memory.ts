import type { AudioStore, AudioEntry } from "./audio-store.js";

/**
 * Creates a fully in-memory AudioStore.
 * All data lives in process memory and is lost on restart.
 * Ideal for testing, development, and demos where disk persistence isn't needed.
 */
export function createMemoryAudioStore(): AudioStore {
  const entries = new Map<string, { entry: AudioEntry; data: Buffer }>();
  /** Maps scopeId -> Set of store keys that belong to that scope */
  const scopeIndex = new Map<string, Set<string>>();
  let nextId = 1;

  function storeKey(id: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${id}` : id;
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

  return {
    async saveAudio(buffer, mimeType, metadata?, scopeId?) {
      const id = `audio_${nextId++}_${Date.now()}`;
      const entry: AudioEntry = {
        id,
        mimeType,
        size: buffer.length,
        createdAt: new Date().toISOString(),
        ...(metadata && { metadata }),
      };
      const key = storeKey(id, scopeId);
      entries.set(key, { entry, data: Buffer.from(buffer) });
      trackScope(key, scopeId);
      return entry;
    },

    async getAudio(id, scopeId?) {
      return entries.get(storeKey(id, scopeId)) ?? null;
    },

    async deleteAudio(id, scopeId?) {
      const key = storeKey(id, scopeId);
      untrackScope(key, scopeId);
      return entries.delete(key);
    },

    async listAudio(scopeId?) {
      if (scopeId) {
        const keys = scopeIndex.get(scopeId);
        if (!keys) return [];
        const result: AudioEntry[] = [];
        for (const key of keys) {
          const item = entries.get(key);
          if (item) result.push(item.entry);
        }
        return result;
      }
      return [...entries.values()].map((e) => e.entry);
    },

    async cleanupOlderThan(maxAgeMs, scopeId?) {
      const cutoff = Date.now() - maxAgeMs;
      let deleted = 0;
      const iterableEntries = scopeId
        ? [...(scopeIndex.get(scopeId) ?? [])].map((key) => [key, entries.get(key)] as const).filter(([, v]) => v != null)
        : [...entries.entries()];

      for (const [key, item] of iterableEntries) {
        if (!item) continue;
        if (new Date(item.entry.createdAt).getTime() < cutoff) {
          entries.delete(key);
          // Remove from the specific scope index (or scan all if no scopeId)
          if (scopeId) {
            scopeIndex.get(scopeId)?.delete(key);
          } else {
            for (const [, set] of scopeIndex) {
              set.delete(key);
            }
          }
          deleted++;
        }
      }
      return deleted;
    },
  };
}
