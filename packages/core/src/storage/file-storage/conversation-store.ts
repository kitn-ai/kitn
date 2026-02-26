import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConversationStore, Conversation, ConversationMessage, ConversationSummary } from "../interfaces.js";

export function createConversationStore(dataDir: string): ConversationStore {
  const baseDir = join(dataDir, "conversations");

  let lock: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let result: Promise<T>;
    const next = prev
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    lock = next;
    return next.then(() => result!);
  }

  /** Resolve the directory for a given scope (or the base dir for global). */
  function scopeDir(scopeId?: string): string {
    return scopeId ? join(baseDir, scopeId) : baseDir;
  }

  function filePath(id: string, scopeId?: string): string {
    return join(scopeDir(scopeId), `${id}.json`);
  }

  async function ensureDir(dir: string) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  async function readConversation(id: string, scopeId?: string): Promise<Conversation | null> {
    const path = filePath(id, scopeId);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf-8");
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function writeConversation(conv: Conversation, scopeId?: string): Promise<void> {
    const dir = scopeDir(scopeId);
    await ensureDir(dir);
    await writeFile(filePath(conv.id, scopeId), JSON.stringify(conv, null, 2));
  }

  /** Read all .json files in a directory as conversation summaries. */
  async function listDir(dir: string): Promise<ConversationSummary[]> {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const summaries: ConversationSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(".json", "");
      const path = join(dir, entry.name);
      try {
        const raw = await readFile(path, "utf-8");
        const conv: Conversation = JSON.parse(raw);
        summaries.push({ id: conv.id, messageCount: conv.messages.length, updatedAt: conv.updatedAt });
      } catch { /* skip corrupted */ }
    }
    return summaries;
  }

  return {
    async get(id, scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);
      return readConversation(id, scopeId);
    },

    async list(scopeId?) {
      if (scopeId) {
        const dir = scopeDir(scopeId);
        await ensureDir(dir);
        return listDir(dir);
      }
      // Without scopeId: list from base dir + all subdirectories
      await ensureDir(baseDir);
      const summaries = await listDir(baseDir);
      const entries = await readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subSummaries = await listDir(join(baseDir, entry.name));
        summaries.push(...subSummaries);
      }
      return summaries;
    },

    create(id, scopeId?) {
      return withLock(async () => {
        await ensureDir(scopeDir(scopeId));
        const now = new Date().toISOString();
        const conv: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
        await writeConversation(conv, scopeId);
        return conv;
      });
    },

    append(id, message, scopeId?) {
      return withLock(async () => {
        await ensureDir(scopeDir(scopeId));
        let conv = await readConversation(id, scopeId);
        if (!conv) {
          const now = new Date().toISOString();
          conv = { id, messages: [], createdAt: now, updatedAt: now };
        }
        conv.messages.push(message);
        conv.updatedAt = new Date().toISOString();
        await writeConversation(conv, scopeId);
        return conv;
      });
    },

    async delete(id, scopeId?) {
      const path = filePath(id, scopeId);
      if (!existsSync(path)) return false;
      await unlink(path);
      return true;
    },

    clear(id, scopeId?) {
      return withLock(async () => {
        let conv = await readConversation(id, scopeId);
        if (!conv) throw new Error(`Conversation not found: ${id}`);
        conv.messages = [];
        conv.updatedAt = new Date().toISOString();
        await writeConversation(conv, scopeId);
        return conv;
      });
    },
  };
}
