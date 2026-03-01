import type {
  StorageProvider,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  ConversationStore,
  MemoryEntry,
  MemoryStore,
  Skill,
  SkillMeta,
  SkillPhase,
  SkillStore,
  Task,
  TaskStore,
  PromptOverride,
  PromptStore,
  CommandRegistration,
  CommandStore,
  CronJob,
  CronExecution,
  CronStore,
  Job,
  JobStore,
} from "@kitn/core";

// ── Types ──

interface MongoCollection {
  findOne(filter: Record<string, unknown>): Promise<any>;
  find(filter: Record<string, unknown>): { sort(s: Record<string, number>): { limit(n: number): { toArray(): Promise<any[]> }; toArray(): Promise<any[]> }; toArray(): Promise<any[]> };
  insertOne(doc: Record<string, unknown>): Promise<{ insertedId: any }>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  distinct(field: string, filter?: Record<string, unknown>): Promise<any[]>;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
  createIndex(spec: Record<string, number>, options?: { unique?: boolean }): Promise<string>;
}

interface MongoDb {
  collection(name: string): MongoCollection;
}

interface MongoClient {
  db(name: string): MongoDb;
}

interface MongoConfig {
  client: MongoClient;
  database: string;
  autoMigrate?: boolean;
  collectionPrefix?: string;
}

// ── Helpers ──

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      const val = rest.join(":").trim();
      meta[key.trim()] = val.startsWith("[") ? val.slice(1, -1).split(",").map((s) => s.trim()) : val;
    }
  }
  return { meta, body: match[2].trim() };
}

function scopeFilter(scopeId?: string): Record<string, unknown> {
  return scopeId ? { scopeId } : {};
}

// ── Indexes ──

async function createIndexes(db: MongoDb, p: string): Promise<void> {
  const col = (name: string) => db.collection(`${p}${name}`);

  await col("conversations").createIndex({ scopeId: 1 });
  await col("conversations").createIndex({ updatedAt: -1 });
  await col("memory").createIndex({ namespace: 1, key: 1, scopeId: 1 }, { unique: true });
  await col("skills").createIndex({ name: 1 });
  await col("tasks").createIndex({ createdAt: 1 });
  await col("prompt_overrides").createIndex({ name: 1 });
  await col("commands").createIndex({ name: 1, scopeId: 1 }, { unique: true });
  await col("cron_jobs").createIndex({ scopeId: 1 });
  await col("cron_jobs").createIndex({ enabled: 1, nextRun: 1 });
  await col("cron_executions").createIndex({ cronId: 1, startedAt: -1 });
  await col("jobs").createIndex({ scopeId: 1 });
  await col("jobs").createIndex({ createdAt: -1 });
}

// ── Conversation Store ──

function createConversationStore(db: MongoDb, p: string): ConversationStore {
  const col = db.collection(`${p}conversations`);

  return {
    async get(id, scopeId?) {
      const doc = await col.findOne({ _id: id as any, ...scopeFilter(scopeId) });
      if (!doc) return null;
      return {
        id: doc._id,
        messages: doc.messages ?? [],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },

    async list(scopeId?) {
      const docs = await col.find(scopeFilter(scopeId)).sort({ updatedAt: -1 }).toArray();
      return docs.map((doc: any) => ({
        id: doc._id,
        messageCount: (doc.messages ?? []).length,
        updatedAt: doc.updatedAt,
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      await col.insertOne({
        _id: id as any,
        scopeId: scopeId ?? null,
        messages: [],
        createdAt: now,
        updatedAt: now,
      });
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      const existing = await col.findOne({ _id: id as any });
      if (!existing) {
        await col.insertOne({
          _id: id as any,
          scopeId: scopeId ?? null,
          messages: [message],
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await col.updateOne(
          { _id: id as any },
          { $push: { messages: message } as any, $set: { updatedAt: now } },
        );
      }
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const { deletedCount } = await col.deleteOne({ _id: id as any, ...scopeFilter(scopeId) });
      return deletedCount > 0;
    },

    async clear(id, scopeId?) {
      const now = new Date().toISOString();
      await col.updateOne(
        { _id: id as any, ...scopeFilter(scopeId) },
        { $set: { messages: [], updatedAt: now } },
      );
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(db: MongoDb, p: string): MemoryStore {
  const col = db.collection(`${p}memory`);

  return {
    async listNamespaces(scopeId?) {
      return col.distinct("namespace", scopeFilter(scopeId));
    },

    async listEntries(namespaceId, scopeId?) {
      const docs = await col.find({ namespace: namespaceId, ...scopeFilter(scopeId) }).toArray();
      return docs.map((d: any) => ({
        key: d.key,
        value: d.value,
        context: d.context ?? "",
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      const filter = { namespace: namespaceId, key, scopeId: scopeId ?? null };
      const existing = await col.findOne(filter);
      if (existing) {
        await col.updateOne(filter, { $set: { value, context, updatedAt: now } });
        return { key, value, context, createdAt: existing.createdAt, updatedAt: now };
      }
      await col.insertOne({ namespace: namespaceId, key, value, context, scopeId: scopeId ?? null, createdAt: now, updatedAt: now });
      return { key, value, context, createdAt: now, updatedAt: now };
    },

    async getEntry(namespaceId, key, scopeId?) {
      const doc = await col.findOne({ namespace: namespaceId, key, ...(scopeId ? { scopeId } : {}) });
      if (!doc) return null;
      return { key: doc.key, value: doc.value, context: doc.context ?? "", createdAt: doc.createdAt, updatedAt: doc.updatedAt };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const { deletedCount } = await col.deleteOne({ namespace: namespaceId, key, ...(scopeId ? { scopeId } : {}) });
      return deletedCount > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      await col.deleteMany({ namespace: namespaceId, ...scopeFilter(scopeId) });
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const docs = await col.find({ namespace: { $in: ids } as any, ...scopeFilter(scopeId) }).toArray();
      return docs.map((d: any) => ({
        namespace: d.namespace,
        key: d.key,
        value: d.value,
        context: d.context ?? "",
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
    },
  };
}

// ── Skill Store ──

function createSkillStore(db: MongoDb, p: string): SkillStore {
  const col = db.collection(`${p}skills`);

  function docToSkill(d: any): Skill {
    return {
      name: d._id,
      description: d.description ?? "",
      tags: d.tags ?? [],
      phase: (d.phase ?? "both") as SkillPhase,
      content: d.content ?? "",
      rawContent: d.rawContent ?? "",
      updatedAt: d.updatedAt,
    };
  }

  return {
    async listSkills() {
      const docs = await col.find({}).sort({ _id: 1 }).toArray();
      return docs.map((d: any) => ({
        name: d._id,
        description: d.description ?? "",
        tags: d.tags ?? [],
        phase: (d.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const doc = await col.findOne({ _id: name as any });
      if (!doc) return null;
      return docToSkill(doc);
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await col.insertOne({
        _id: name as any,
        description: (meta.description as string) ?? "",
        tags: (meta.tags as string[]) ?? [],
        phase: (meta.phase as string) ?? "both",
        content: body,
        rawContent: rawContent,
        updatedAt: now,
      });
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await col.updateOne({ _id: name as any }, {
        $set: {
          description: (meta.description as string) ?? "",
          tags: (meta.tags as string[]) ?? [],
          phase: (meta.phase as string) ?? "both",
          content: body,
          rawContent: rawContent,
          updatedAt: now,
        },
      });
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const { deletedCount } = await col.deleteOne({ _id: name as any });
      return deletedCount > 0;
    },

    async getSkillSummaries() {
      const docs = await col.find({}).sort({ _id: 1 }).toArray();
      if (!docs.length) return "";
      return docs.map((d: any) => `- ${d._id}: ${d.description ?? ""}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(db: MongoDb, p: string): TaskStore {
  const col = db.collection(`${p}tasks`);

  function docToTask(d: any): Task {
    return { id: d._id, title: d.title, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await col.insertOne({ _id: id as any, title, status: "todo", createdAt: now, updatedAt: now });
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      const docs = await col.find({}).sort({ createdAt: 1 }).toArray();
      return docs.map(docToTask);
    },

    async updateTask(id, updates) {
      const now = new Date().toISOString();
      const setValues: any = { updatedAt: now };
      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.status !== undefined) setValues.status = updates.status;
      await col.updateOne({ _id: id as any }, { $set: setValues });
      const doc = await col.findOne({ _id: id as any });
      return docToTask(doc);
    },

    async deleteTask(id) {
      const { deletedCount } = await col.deleteOne({ _id: id as any });
      return deletedCount > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(db: MongoDb, p: string): PromptStore {
  const col = db.collection(`${p}prompt_overrides`);

  return {
    async loadOverrides() {
      const docs = await col.find({}).toArray();
      const result: Record<string, PromptOverride> = {};
      for (const d of docs) {
        result[d._id] = { prompt: d.prompt, updatedAt: d.updatedAt };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      await col.updateOne(
        { _id: name as any },
        { $set: { prompt, updatedAt: now } },
        { upsert: true },
      );
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { deletedCount } = await col.deleteOne({ _id: name as any });
      return deletedCount > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(db: MongoDb, p: string): CommandStore {
  const col = db.collection(`${p}commands`);

  function docToCommand(d: any): CommandRegistration {
    return {
      name: d.name,
      description: d.description ?? "",
      system: d.system ?? "",
      tools: d.tools ?? [],
      model: d.model ?? undefined,
      format: d.format ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const docs = await col.find({ scopeId: scopeId ?? "" }).sort({ name: 1 }).toArray();
      return docs.map(docToCommand);
    },

    async get(name, scopeId?) {
      const doc = await col.findOne({ name, scopeId: scopeId ?? "" });
      return doc ? docToCommand(doc) : undefined;
    },

    async save(command, scopeId?) {
      await col.updateOne(
        { name: command.name, scopeId: scopeId ?? "" },
        {
          $set: {
            name: command.name,
            scopeId: scopeId ?? "",
            description: command.description,
            system: command.system,
            tools: command.tools ?? [],
            model: command.model ?? null,
            format: command.format ?? null,
          },
        },
        { upsert: true },
      );
    },

    async delete(name, scopeId?) {
      await col.deleteOne({ name, scopeId: scopeId ?? "" });
    },
  };
}

// ── Cron Store ──

function createCronStore(db: MongoDb, p: string): CronStore {
  const col = db.collection(`${p}cron_jobs`);
  const execCol = db.collection(`${p}cron_executions`);

  function docToCronJob(d: any): CronJob {
    return {
      id: d._id,
      name: d.name,
      description: d.description ?? "",
      schedule: d.schedule ?? undefined,
      runAt: d.runAt ?? undefined,
      agentName: d.agentName,
      input: d.input ?? "",
      model: d.model ?? undefined,
      timezone: d.timezone ?? "UTC",
      enabled: d.enabled,
      nextRun: d.nextRun ?? undefined,
      lastRun: d.lastRun ?? undefined,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  function docToExecution(d: any): CronExecution {
    return {
      id: d._id,
      cronId: d.cronId,
      startedAt: d.startedAt,
      completedAt: d.completedAt ?? undefined,
      status: d.status,
      summary: d.summary ?? undefined,
      error: d.error ?? undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await col.insertOne({
        _id: id as any,
        name: input.name, description: input.description,
        schedule: input.schedule ?? null, runAt: input.runAt ?? null,
        agentName: input.agentName, input: input.input,
        model: input.model ?? null, timezone: input.timezone ?? "UTC",
        enabled: input.enabled, nextRun: input.nextRun ?? null,
        lastRun: input.lastRun ?? null, scopeId: scopeId ?? null,
        createdAt: now, updatedAt: now,
      });
      const doc = await col.findOne({ _id: id as any });
      return docToCronJob(doc);
    },

    async get(id, scopeId?) {
      const doc = await col.findOne({ _id: id as any, ...scopeFilter(scopeId) });
      return doc ? docToCronJob(doc) : null;
    },

    async list(scopeId?) {
      const docs = await col.find(scopeFilter(scopeId)).sort({ createdAt: 1 }).toArray();
      return docs.map(docToCronJob);
    },

    async update(id, updates, scopeId?) {
      const now = new Date().toISOString();
      const setValues: any = { updatedAt: updates.updatedAt ?? now };
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.schedule !== undefined) setValues.schedule = updates.schedule;
      if (updates.runAt !== undefined) setValues.runAt = updates.runAt;
      if (updates.agentName !== undefined) setValues.agentName = updates.agentName;
      if (updates.input !== undefined) setValues.input = updates.input;
      if (updates.model !== undefined) setValues.model = updates.model;
      if (updates.timezone !== undefined) setValues.timezone = updates.timezone;
      if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
      if (updates.nextRun !== undefined) setValues.nextRun = updates.nextRun;
      if (updates.lastRun !== undefined) setValues.lastRun = updates.lastRun;
      await col.updateOne({ _id: id as any, ...scopeFilter(scopeId) }, { $set: setValues });
      const doc = await col.findOne({ _id: id as any });
      return docToCronJob(doc);
    },

    async delete(id, scopeId?) {
      // Also delete executions
      await execCol.deleteMany({ cronId: id });
      const { deletedCount } = await col.deleteOne({ _id: id as any, ...scopeFilter(scopeId) });
      return deletedCount > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      await execCol.insertOne({
        _id: id as any,
        cronId: input.cronId,
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? null,
        status: input.status,
        summary: input.summary ?? null,
        error: input.error ?? null,
        scopeId: scopeId ?? null,
      });
      const doc = await execCol.findOne({ _id: id as any });
      return docToExecution(doc);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const filter: any = { cronId };
      if (scopeId) filter.scopeId = scopeId;
      const docs = await execCol.find(filter).sort({ startedAt: -1 }).limit(limit).toArray();
      return docs.map(docToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const setValues: any = {};
      if (updates.completedAt !== undefined) setValues.completedAt = updates.completedAt;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.summary !== undefined) setValues.summary = updates.summary;
      if (updates.error !== undefined) setValues.error = updates.error;
      const filter: any = { _id: id as any };
      if (scopeId) filter.scopeId = scopeId;
      if (Object.keys(setValues).length) {
        await execCol.updateOne(filter, { $set: setValues });
      }
      const doc = await execCol.findOne({ _id: id as any });
      return docToExecution(doc);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const filter: any = {
        enabled: true,
        ...scopeFilter(scopeId),
        $or: [
          { nextRun: { $lte: iso } },
          { runAt: { $lte: iso }, lastRun: null },
        ],
      };
      const docs = await col.find(filter).sort({ nextRun: 1 }).toArray();
      return docs.map(docToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(db: MongoDb, p: string): JobStore {
  const col = db.collection(`${p}jobs`);

  function docToJob(d: any): Job {
    return {
      id: d._id,
      agentName: d.agentName,
      input: d.input ?? "",
      conversationId: d.conversationId,
      scopeId: d.scopeId ?? undefined,
      status: d.status,
      result: d.result ?? undefined,
      error: d.error ?? undefined,
      usage: d.usage ?? undefined,
      toolsUsed: d.toolsUsed ?? undefined,
      createdAt: d.createdAt,
      startedAt: d.startedAt ?? undefined,
      completedAt: d.completedAt ?? undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await col.insertOne({
        _id: id as any,
        agentName: job.agentName,
        input: job.input,
        conversationId: job.conversationId,
        scopeId: job.scopeId ?? null,
        status: job.status,
        result: job.result ?? null,
        error: job.error ?? null,
        usage: job.usage ?? null,
        toolsUsed: job.toolsUsed ?? null,
        createdAt: now,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
      });
      const doc = await col.findOne({ _id: id as any });
      return docToJob(doc);
    },

    async get(id, scopeId?) {
      const doc = await col.findOne({ _id: id as any, ...scopeFilter(scopeId) });
      return doc ? docToJob(doc) : null;
    },

    async list(scopeId?) {
      const docs = await col.find(scopeFilter(scopeId)).sort({ createdAt: -1 }).toArray();
      return docs.map(docToJob);
    },

    async update(id, updates) {
      const setValues: any = {};
      if (updates.agentName !== undefined) setValues.agentName = updates.agentName;
      if (updates.input !== undefined) setValues.input = updates.input;
      if (updates.conversationId !== undefined) setValues.conversationId = updates.conversationId;
      if (updates.scopeId !== undefined) setValues.scopeId = updates.scopeId;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.result !== undefined) setValues.result = updates.result;
      if (updates.error !== undefined) setValues.error = updates.error;
      if (updates.startedAt !== undefined) setValues.startedAt = updates.startedAt;
      if (updates.completedAt !== undefined) setValues.completedAt = updates.completedAt;
      if (updates.usage) setValues.usage = updates.usage;
      if (updates.toolsUsed !== undefined) setValues.toolsUsed = updates.toolsUsed;
      if (Object.keys(setValues).length) {
        await col.updateOne({ _id: id as any }, { $set: setValues });
      }
      const doc = await col.findOne({ _id: id as any });
      return docToJob(doc);
    },

    async delete(id, scopeId?) {
      const { deletedCount } = await col.deleteOne({ _id: id as any, ...scopeFilter(scopeId) });
      return deletedCount > 0;
    },
  };
}

// ── Factory ──

export async function createMongoStorage(config: MongoConfig): Promise<StorageProvider> {
  const db = config.client.db(config.database);
  const p = config.collectionPrefix ?? "kitn_";

  if (config.autoMigrate !== false) {
    await createIndexes(db, p);
  }

  return {
    conversations: createConversationStore(db, p),
    memory: createMemoryStore(db, p),
    skills: createSkillStore(db, p),
    tasks: createTaskStore(db, p),
    prompts: createPromptStore(db, p),
    commands: createCommandStore(db, p),
    crons: createCronStore(db, p),
    jobs: createJobStore(db, p),
  };
}
