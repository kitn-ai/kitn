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

  return {
    async get(id) {
      return store.get(id) ?? null;
    },

    async list() {
      const summaries: ConversationSummary[] = [];
      for (const conv of store.values()) {
        summaries.push({
          id: conv.id,
          messageCount: conv.messages.length,
          updatedAt: conv.updatedAt,
        });
      }
      return summaries;
    },

    async create(id) {
      const now = new Date().toISOString();
      const conv: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
      store.set(id, conv);
      return conv;
    },

    async append(id, message) {
      let conv = store.get(id);
      if (!conv) {
        const now = new Date().toISOString();
        conv = { id, messages: [], createdAt: now, updatedAt: now };
        store.set(id, conv);
      }
      conv.messages.push(message);
      conv.updatedAt = new Date().toISOString();
      return conv;
    },

    async delete(id) {
      return store.delete(id);
    },

    async clear(id) {
      const conv = store.get(id);
      if (!conv) {
        const now = new Date().toISOString();
        const fresh: Conversation = { id, messages: [], createdAt: now, updatedAt: now };
        store.set(id, fresh);
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
  let nextId = 1;

  return {
    async saveAudio(buffer, mimeType, metadata) {
      const id = `audio_${nextId++}_${Date.now()}`;
      const entry: AudioEntry = {
        id,
        mimeType,
        size: buffer.length,
        createdAt: new Date().toISOString(),
        ...(metadata && { metadata }),
      };
      entries.set(id, { entry, data: Buffer.from(buffer) });
      return entry;
    },

    async getAudio(id) {
      return entries.get(id) ?? null;
    },

    async deleteAudio(id) {
      return entries.delete(id);
    },

    async listAudio() {
      return [...entries.values()].map((e) => e.entry);
    },

    async cleanupOlderThan(maxAgeMs) {
      const cutoff = Date.now() - maxAgeMs;
      let deleted = 0;
      for (const [id, { entry }] of entries) {
        if (new Date(entry.createdAt).getTime() < cutoff) {
          entries.delete(id);
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
