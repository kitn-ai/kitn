import type {
  StorageProvider,
  ConversationStore,
  Conversation,
  ConversationSummary,
  SkillStore,
  SkillMeta,
  TaskStore,
  Task,
  PromptStore,
  PromptOverride,
  AudioStore,
  AudioEntry,
} from "../interfaces.js";
import { createInMemoryMemoryStore } from "./memory-store.js";
import { createCommandStore } from "./command-store.js";
import { parseFrontmatter, parsePhase, buildSkill, KEBAB_CASE } from "../skill-helpers.js";

// ── Conversation Store ──

function createConversationStore(): ConversationStore {
  const store = new Map<string, Conversation>();
  /** Maps scopeId -> Set of store keys that belong to that scope */
  const scopeIndex = new Map<string, Set<string>>();

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
    async get(id, scopeId?) {
      if (scopeId) {
        return store.get(storeKey(id, scopeId)) ?? null;
      }
      // Without scopeId, check the unscoped key first, then search all entries
      const direct = store.get(id);
      if (direct) return direct;
      for (const conv of store.values()) {
        if (conv.id === id) return conv;
      }
      return null;
    },

    async list(scopeId?) {
      const summaries: ConversationSummary[] = [];
      if (scopeId) {
        const keys = scopeIndex.get(scopeId);
        if (keys) {
          for (const key of keys) {
            const conv = store.get(key);
            if (conv) {
              summaries.push({ id: conv.id, messageCount: conv.messages.length, updatedAt: conv.updatedAt });
            }
          }
        }
      } else {
        for (const conv of store.values()) {
          summaries.push({ id: conv.id, messageCount: conv.messages.length, updatedAt: conv.updatedAt });
        }
      }
      return summaries;
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      const conv: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
      const key = storeKey(id, scopeId);
      store.set(key, conv);
      trackScope(key, scopeId);
      return conv;
    },

    async append(id, message, scopeId?) {
      const key = storeKey(id, scopeId);
      let conv = store.get(key);
      if (!conv) {
        const now = new Date().toISOString();
        conv = { id, messages: [], createdAt: now, updatedAt: now };
        store.set(key, conv);
        trackScope(key, scopeId);
      }
      conv.messages.push(message);
      conv.updatedAt = new Date().toISOString();
      return conv;
    },

    async delete(id, scopeId?) {
      const key = storeKey(id, scopeId);
      untrackScope(key, scopeId);
      return store.delete(key);
    },

    async clear(id, scopeId?) {
      const key = storeKey(id, scopeId);
      const conv = store.get(key);
      if (!conv) {
        const now = new Date().toISOString();
        const fresh: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
        store.set(key, fresh);
        trackScope(key, scopeId);
        return fresh;
      }
      conv.messages = [];
      conv.updatedAt = new Date().toISOString();
      return conv;
    },
  };
}

// ── Skill Store ──

function createSkillStore(): SkillStore {
  const store = new Map<string, string>(); // name -> raw content

  return {
    async listSkills() {
      const skills: SkillMeta[] = [];
      for (const [name, raw] of store) {
        const { meta } = parseFrontmatter(raw);
        skills.push({
          name: (meta.name as string) || name,
          description: (meta.description as string) || "",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          phase: parsePhase(meta.phase),
        });
      }
      return skills;
    },

    async getSkill(name) {
      const raw = store.get(name);
      if (!raw) return null;
      return buildSkill(name, raw);
    },

    async createSkill(name, content) {
      if (!KEBAB_CASE.test(name)) {
        throw new Error(`Invalid skill name "${name}": must be kebab-case (e.g. "my-skill")`);
      }
      if (store.has(name)) throw new Error(`Skill "${name}" already exists`);
      store.set(name, content);
      return buildSkill(name, content);
    },

    async updateSkill(name, content) {
      if (!store.has(name)) throw new Error(`Skill "${name}" not found`);
      store.set(name, content);
      return buildSkill(name, content);
    },

    async deleteSkill(name) {
      return store.delete(name);
    },

    async getSkillSummaries() {
      const skills = await this.listSkills();
      if (skills.length === 0) return "No skills available.";
      return skills.map((s) => `- ${s.name} [${s.phase}]: ${s.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(): TaskStore {
  const store = new Map<string, Task>();
  let nextId = 1;

  return {
    async createTask(title) {
      const now = new Date().toISOString();
      const task: Task = { id: String(nextId++), title, status: "todo", createdAt: now, updatedAt: now };
      store.set(task.id, task);
      return task;
    },

    async listTasks() {
      return [...store.values()];
    },

    async updateTask(id, updates) {
      const task = store.get(id);
      if (!task) throw new Error(`Task "${id}" not found`);
      if (updates.title !== undefined) task.title = updates.title;
      if (updates.status !== undefined) task.status = updates.status;
      task.updatedAt = new Date().toISOString();
      return task;
    },

    async deleteTask(id) {
      return store.delete(id);
    },
  };
}

// ── Prompt Store ──

function createPromptStore(): PromptStore {
  const store = new Map<string, PromptOverride>();

  return {
    async loadOverrides() {
      const result: Record<string, PromptOverride> = {};
      for (const [name, override] of store) {
        result[name] = override;
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const override: PromptOverride = { prompt, updatedAt: new Date().toISOString() };
      store.set(name, override);
      return override;
    },

    async deleteOverride(name) {
      return store.delete(name);
    },
  };
}

// ── Audio Store ──

function createAudioStore(): AudioStore {
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
          // Also remove from scope index
          for (const [, set] of scopeIndex) {
            set.delete(key);
          }
          deleted++;
        }
      }
      return deleted;
    },
  };
}

// ── Combined Provider ──

/**
 * Creates a fully in-memory StorageProvider.
 * All data lives in process memory and is lost on restart.
 * Ideal for testing, development, and demos where disk persistence isn't needed.
 */
export function createMemoryStorage(): StorageProvider {
  return {
    conversations: createConversationStore(),
    memory: createInMemoryMemoryStore(),
    skills: createSkillStore(),
    tasks: createTaskStore(),
    prompts: createPromptStore(),
    audio: createAudioStore(),
    commands: createCommandStore(),
  };
}
