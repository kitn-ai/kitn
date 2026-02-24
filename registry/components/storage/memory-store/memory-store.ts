import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** A single key-value memory entry within a namespace */
export interface MemoryEntry {
  key: string;
  value: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStore {
  listNamespaces(): Promise<string[]>;
  listEntries(namespaceId: string): Promise<MemoryEntry[]>;
  saveEntry(namespaceId: string, key: string, value: string, context?: string): Promise<MemoryEntry>;
  getEntry(namespaceId: string, key: string): Promise<MemoryEntry | null>;
  deleteEntry(namespaceId: string, key: string): Promise<boolean>;
  clearNamespace(namespaceId: string): Promise<void>;
  loadMemoriesForIds(ids: string[]): Promise<Array<MemoryEntry & { namespace: string }>>;
}

type NamespaceData = Record<string, MemoryEntry>;

export function createMemoryStore(dataDir: string): MemoryStore {
  const dir = join(dataDir, "memory");

  const locks = new Map<string, Promise<void>>();
  function withLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(namespace) ?? Promise.resolve();
    let result: Promise<T>;
    const next = prev
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    locks.set(namespace, next);
    return next.then(() => result!);
  }

  function namespacePath(namespaceId: string): string { return join(dir, `${namespaceId}.json`); }

  async function ensureDir() {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  async function readNamespace(namespaceId: string): Promise<NamespaceData> {
    await ensureDir();
    const path = namespacePath(namespaceId);
    if (!existsSync(path)) return {};
    const raw = await readFile(path, "utf-8");
    try { return JSON.parse(raw); } catch { return {}; }
  }

  async function writeNamespace(namespaceId: string, data: NamespaceData): Promise<void> {
    await ensureDir();
    await writeFile(namespacePath(namespaceId), JSON.stringify(data, null, 2));
  }

  return {
    async listNamespaces() {
      await ensureDir();
      const files = await readdir(dir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
    },

    async listEntries(namespaceId) {
      const data = await readNamespace(namespaceId);
      return Object.values(data);
    },

    saveEntry(namespaceId, key, value, context = "") {
      return withLock(namespaceId, async () => {
        const data = await readNamespace(namespaceId);
        const now = new Date().toISOString();
        const entry: MemoryEntry = {
          key, value, context,
          createdAt: data[key]?.createdAt ?? now,
          updatedAt: now,
        };
        data[key] = entry;
        await writeNamespace(namespaceId, data);
        return entry;
      });
    },

    async getEntry(namespaceId, key) {
      const data = await readNamespace(namespaceId);
      return data[key] ?? null;
    },

    deleteEntry(namespaceId, key) {
      return withLock(namespaceId, async () => {
        const data = await readNamespace(namespaceId);
        if (!data[key]) return false;
        delete data[key];
        await writeNamespace(namespaceId, data);
        return true;
      });
    },

    clearNamespace(namespaceId) {
      return withLock(namespaceId, async () => {
        const path = namespacePath(namespaceId);
        if (existsSync(path)) await unlink(path);
      });
    },

    async loadMemoriesForIds(ids) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      await Promise.all(
        ids.map(async (id) => {
          const data = await readNamespace(id);
          for (const entry of Object.values(data)) {
            results.push({ ...entry, namespace: id });
          }
        }),
      );
      return results;
    },
  };
}
