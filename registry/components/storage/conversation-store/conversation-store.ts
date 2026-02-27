import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

/** A single message within a conversation */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** Full conversation record including all messages */
export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Lightweight conversation summary for listing */
export interface ConversationSummary {
  id: string;
  messageCount: number;
  updatedAt: string;
}

export interface ConversationStore {
  get(id: string): Promise<Conversation | null>;
  list(): Promise<ConversationSummary[]>;
  create(id: string): Promise<Conversation>;
  append(id: string, message: ConversationMessage): Promise<Conversation>;
  delete(id: string): Promise<boolean>;
  clear(id: string): Promise<Conversation>;
}

export function createConversationStore(dataDir: string): ConversationStore {
  const dir = `${dataDir}/conversations`;

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

  function filePath(id: string): string { return `${dir}/${id}.json`; }

  async function ensureDir() {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  async function readConversation(id: string): Promise<Conversation | null> {
    const path = filePath(id);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf-8");
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function writeConversation(conv: Conversation): Promise<void> {
    await ensureDir();
    await writeFile(filePath(conv.id), JSON.stringify(conv, null, 2));
  }

  return {
    async get(id) {
      await ensureDir();
      return readConversation(id);
    },

    async list() {
      await ensureDir();
      if (!existsSync(dir)) return [];
      const files = await readdir(dir);
      const summaries: ConversationSummary[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const id = file.replace(".json", "");
        const conv = await readConversation(id);
        if (conv) {
          summaries.push({ id: conv.id, messageCount: conv.messages.length, updatedAt: conv.updatedAt });
        }
      }
      return summaries;
    },

    create(id) {
      return withLock(async () => {
        await ensureDir();
        const now = new Date().toISOString();
        const conv: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
        await writeConversation(conv);
        return conv;
      });
    },

    append(id, message) {
      return withLock(async () => {
        await ensureDir();
        let conv = await readConversation(id);
        if (!conv) {
          const now = new Date().toISOString();
          conv = { id, messages: [], createdAt: now, updatedAt: now };
        }
        conv.messages.push(message);
        conv.updatedAt = new Date().toISOString();
        await writeConversation(conv);
        return conv;
      });
    },

    async delete(id) {
      const path = filePath(id);
      if (!existsSync(path)) return false;
      await unlink(path);
      return true;
    },

    clear(id) {
      return withLock(async () => {
        let conv = await readConversation(id);
        if (!conv) throw new Error(`Conversation not found: ${id}`);
        conv.messages = [];
        conv.updatedAt = new Date().toISOString();
        await writeConversation(conv);
        return conv;
      });
    },
  };
}
