import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MemoryStore, MemoryEntry } from "../interfaces.js";

type NamespaceData = Record<string, MemoryEntry>;

export function createMemoryStore(dataDir: string): MemoryStore {
  const baseDir = join(dataDir, "memory");

  const locks = new Map<string, Promise<void>>();
  function withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(lockKey) ?? Promise.resolve();
    let result: Promise<T>;
    const next = prev
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    locks.set(lockKey, next);
    return next.then(() => result!);
  }

  /** Resolve the directory for a given scope (or the base dir for global). */
  function scopeDir(scopeId?: string): string {
    return scopeId ? join(baseDir, scopeId) : baseDir;
  }

  function namespacePath(namespaceId: string, scopeId?: string): string {
    return join(scopeDir(scopeId), `${namespaceId}.json`);
  }

  async function ensureDir(dir: string) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  async function readNamespace(namespaceId: string, scopeId?: string): Promise<NamespaceData> {
    const dir = scopeDir(scopeId);
    await ensureDir(dir);
    const path = namespacePath(namespaceId, scopeId);
    if (!existsSync(path)) return {};
    const raw = await readFile(path, "utf-8");
    try { return JSON.parse(raw); } catch { return {}; }
  }

  async function writeNamespace(namespaceId: string, data: NamespaceData, scopeId?: string): Promise<void> {
    const dir = scopeDir(scopeId);
    await ensureDir(dir);
    await writeFile(namespacePath(namespaceId, scopeId), JSON.stringify(data, null, 2));
  }

  /** List .json files in a directory as namespace IDs. */
  async function listJsonFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name.replace(".json", ""));
  }

  return {
    async listNamespaces(scopeId?) {
      if (scopeId) {
        const dir = scopeDir(scopeId);
        await ensureDir(dir);
        return listJsonFiles(dir);
      }
      // Without scopeId: list from base dir + all subdirectories
      await ensureDir(baseDir);
      const namespaces = await listJsonFiles(baseDir);
      const entries = await readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subNamespaces = await listJsonFiles(join(baseDir, entry.name));
        namespaces.push(...subNamespaces);
      }
      return [...new Set(namespaces)];
    },

    async listEntries(namespaceId, scopeId?) {
      const data = await readNamespace(namespaceId, scopeId);
      return Object.values(data);
    },

    saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const lockKey = scopeId ? `${scopeId}:${namespaceId}` : namespaceId;
      return withLock(lockKey, async () => {
        const data = await readNamespace(namespaceId, scopeId);
        const now = new Date().toISOString();
        const entry: MemoryEntry = {
          key, value, context,
          createdAt: data[key]?.createdAt ?? now,
          updatedAt: now,
        };
        data[key] = entry;
        await writeNamespace(namespaceId, data, scopeId);
        return entry;
      });
    },

    async getEntry(namespaceId, key, scopeId?) {
      const data = await readNamespace(namespaceId, scopeId);
      return data[key] ?? null;
    },

    deleteEntry(namespaceId, key, scopeId?) {
      const lockKey = scopeId ? `${scopeId}:${namespaceId}` : namespaceId;
      return withLock(lockKey, async () => {
        const data = await readNamespace(namespaceId, scopeId);
        if (!data[key]) return false;
        delete data[key];
        await writeNamespace(namespaceId, data, scopeId);
        return true;
      });
    },

    clearNamespace(namespaceId, scopeId?) {
      const lockKey = scopeId ? `${scopeId}:${namespaceId}` : namespaceId;
      return withLock(lockKey, async () => {
        const path = namespacePath(namespaceId, scopeId);
        if (existsSync(path)) await unlink(path);
      });
    },

    async loadMemoriesForIds(ids, scopeId?) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      await Promise.all(
        ids.map(async (id) => {
          const data = await readNamespace(id, scopeId);
          for (const entry of Object.values(data)) {
            results.push({ ...entry, namespace: id });
          }
        }),
      );
      return results;
    },
  };
}
