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
import { eq, and, sql, desc, asc, lte, isNull, or, inArray } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  jsonb,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

// ── Types ──

interface DrizzleConfig {
  db: any;
  dialect: "pg" | "sqlite" | "mysql";
  autoMigrate?: boolean;
  tablePrefix?: string;
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

function jsonParse<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Schema (PostgreSQL — reference dialect) ──
// For SQLite/MySQL users: auto-migrate uses raw SQL adapted to the dialect.
// These Drizzle table objects can be exported for use with drizzle-kit migrations.

export function createSchema(p: string) {
  const conversations = pgTable(`${p}conversations`, {
    id: text("id").primaryKey(),
    scopeId: text("scope_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const conversationMessages = pgTable(`${p}conversation_messages`, {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  });

  const memoryEntries = pgTable(`${p}memory_entries`, {
    namespaceId: text("namespace_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    context: text("context").notNull().default(""),
    scopeId: text("scope_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const skills = pgTable(`${p}skills`, {
    name: text("name").primaryKey(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").notNull().default([]),
    phase: text("phase").notNull().default("both"),
    content: text("content").notNull().default(""),
    rawContent: text("raw_content").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const tasks = pgTable(`${p}tasks`, {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    status: text("status").notNull().default("todo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const promptOverrides = pgTable(`${p}prompt_overrides`, {
    name: text("name").primaryKey(),
    prompt: text("prompt").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const commands = pgTable(`${p}commands`, {
    name: text("name").notNull(),
    scopeId: text("scope_id").notNull().default(""),
    description: text("description").notNull().default(""),
    system: text("system").notNull().default(""),
    tools: jsonb("tools").notNull().default([]),
    model: text("model"),
    format: text("format"),
  });

  const cronJobs = pgTable(`${p}cron_jobs`, {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    schedule: text("schedule"),
    runAt: timestamp("run_at", { withTimezone: true }),
    agentName: text("agent_name").notNull(),
    input: text("input").notNull().default(""),
    model: text("model"),
    timezone: text("timezone").default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    nextRun: timestamp("next_run", { withTimezone: true }),
    lastRun: timestamp("last_run", { withTimezone: true }),
    scopeId: text("scope_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const cronExecutions = pgTable(`${p}cron_executions`, {
    id: text("id").primaryKey(),
    cronId: text("cron_id").notNull().references(() => cronJobs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull(),
    summary: text("summary"),
    error: text("error"),
    scopeId: text("scope_id"),
  });

  const jobs = pgTable(`${p}jobs`, {
    id: text("id").primaryKey(),
    agentName: text("agent_name").notNull(),
    input: text("input").notNull().default(""),
    conversationId: text("conversation_id").notNull(),
    scopeId: text("scope_id"),
    status: text("status").notNull().default("queued"),
    result: text("result"),
    error: text("error"),
    usagePromptTokens: integer("usage_prompt_tokens"),
    usageCompletionTokens: integer("usage_completion_tokens"),
    usageTotalTokens: integer("usage_total_tokens"),
    toolsUsed: jsonb("tools_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  });

  return {
    conversations,
    conversationMessages,
    memoryEntries,
    skills,
    tasks,
    promptOverrides,
    commands,
    cronJobs,
    cronExecutions,
    jobs,
  };
}

// ── Auto-migrate (raw SQL for all dialects) ──

async function runMigrations(db: any, dialect: string, p: string): Promise<void> {
  const isPostgres = dialect === "pg";
  const tsType = isPostgres ? "TIMESTAMPTZ" : "TEXT";
  const boolType = isPostgres ? "BOOLEAN" : "INTEGER";
  const intType = isPostgres ? "INT" : "INTEGER";
  const serialPk = isPostgres ? "id SERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const jsonType = isPostgres ? "JSONB" : "TEXT";
  const defaultTrue = isPostgres ? "DEFAULT TRUE" : "DEFAULT 1";
  const defaultNow = isPostgres ? "DEFAULT NOW()" : "";
  const notNullDefault = (val: string) => `NOT NULL DEFAULT '${val}'`;

  const statements = [
    `CREATE TABLE IF NOT EXISTS ${p}conversations (id TEXT PRIMARY KEY, scope_id TEXT, created_at ${tsType} NOT NULL ${defaultNow}, updated_at ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}conversation_messages (${serialPk}, conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, metadata ${jsonType}, timestamp ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}memory_entries (namespace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, context TEXT ${notNullDefault("")}, scope_id TEXT, created_at ${tsType} NOT NULL ${defaultNow}, updated_at ${tsType} NOT NULL ${defaultNow}, PRIMARY KEY (namespace_id, key, COALESCE(scope_id, '')))`,
    `CREATE TABLE IF NOT EXISTS ${p}skills (name TEXT PRIMARY KEY, description TEXT ${notNullDefault("")}, tags ${jsonType} ${notNullDefault("[]")}, phase TEXT ${notNullDefault("both")}, content TEXT ${notNullDefault("")}, raw_content TEXT ${notNullDefault("")}, updated_at ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT ${notNullDefault("todo")}, created_at ${tsType} NOT NULL ${defaultNow}, updated_at ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (name TEXT PRIMARY KEY, prompt TEXT NOT NULL, updated_at ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}commands (name TEXT NOT NULL, scope_id TEXT ${notNullDefault("")}, description TEXT ${notNullDefault("")}, system TEXT ${notNullDefault("")}, tools ${jsonType} ${notNullDefault("[]")}, model TEXT, format TEXT, PRIMARY KEY (name, scope_id))`,
    `CREATE TABLE IF NOT EXISTS ${p}cron_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT ${notNullDefault("")}, schedule TEXT, run_at ${tsType}, agent_name TEXT NOT NULL, input TEXT ${notNullDefault("")}, model TEXT, timezone TEXT DEFAULT 'UTC', enabled ${boolType} NOT NULL ${defaultTrue}, next_run ${tsType}, last_run ${tsType}, scope_id TEXT, created_at ${tsType} NOT NULL ${defaultNow}, updated_at ${tsType} NOT NULL ${defaultNow})`,
    `CREATE TABLE IF NOT EXISTS ${p}cron_executions (id TEXT PRIMARY KEY, cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE, started_at ${tsType} NOT NULL, completed_at ${tsType}, status TEXT NOT NULL, summary TEXT, error TEXT, scope_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS ${p}jobs (id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, input TEXT ${notNullDefault("")}, conversation_id TEXT NOT NULL, scope_id TEXT, status TEXT ${notNullDefault("queued")}, result TEXT, error TEXT, usage_prompt_tokens ${intType}, usage_completion_tokens ${intType}, usage_total_tokens ${intType}, tools_used ${jsonType}, created_at ${tsType} NOT NULL ${defaultNow}, started_at ${tsType}, completed_at ${tsType})`,
  ];

  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

// ── Conversation Store ──

function createConversationStore(db: any, s: ReturnType<typeof createSchema>): ConversationStore {
  return {
    async get(id, scopeId?) {
      const conditions = scopeId
        ? and(eq(s.conversations.id, id), eq(s.conversations.scopeId, scopeId))
        : eq(s.conversations.id, id);
      const rows = await db.select().from(s.conversations).where(conditions);
      if (!rows.length) return null;
      const row = rows[0];
      const messages = await db
        .select()
        .from(s.conversationMessages)
        .where(eq(s.conversationMessages.conversationId, id))
        .orderBy(asc(s.conversationMessages.id));
      return {
        id: row.id,
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
          metadata: typeof m.metadata === "string" ? jsonParse(m.metadata, undefined) : m.metadata ?? undefined,
        })),
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      };
    },

    async list(scopeId?) {
      const conditions = scopeId ? eq(s.conversations.scopeId, scopeId) : undefined;
      const rows = await db
        .select({
          id: s.conversations.id,
          updatedAt: s.conversations.updatedAt,
          messageCount: sql<number>`count(${s.conversationMessages.id})`.as("message_count"),
        })
        .from(s.conversations)
        .leftJoin(s.conversationMessages, eq(s.conversationMessages.conversationId, s.conversations.id))
        .where(conditions)
        .groupBy(s.conversations.id)
        .orderBy(desc(s.conversations.updatedAt));
      return rows.map((r: any) => ({
        id: r.id,
        messageCount: Number(r.messageCount),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      await db.insert(s.conversations).values({ id, scopeId: scopeId ?? null, createdAt: now, updatedAt: now });
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      const existing = await db.select({ id: s.conversations.id }).from(s.conversations).where(eq(s.conversations.id, id));
      if (!existing.length) {
        await db.insert(s.conversations).values({ id, scopeId: scopeId ?? null, createdAt: now, updatedAt: now });
      } else {
        await db.update(s.conversations).set({ updatedAt: now }).where(eq(s.conversations.id, id));
      }
      await db.insert(s.conversationMessages).values({
        conversationId: id,
        role: message.role,
        content: message.content,
        metadata: message.metadata ? JSON.stringify(message.metadata) : null,
        timestamp: message.timestamp,
      });
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const conditions = scopeId
        ? and(eq(s.conversations.id, id), eq(s.conversations.scopeId, scopeId))
        : eq(s.conversations.id, id);
      const result = await db.delete(s.conversations).where(conditions);
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },

    async clear(id, scopeId?) {
      const now = new Date().toISOString();
      await db.delete(s.conversationMessages).where(eq(s.conversationMessages.conversationId, id));
      const conditions = scopeId
        ? and(eq(s.conversations.id, id), eq(s.conversations.scopeId, scopeId))
        : eq(s.conversations.id, id);
      await db.update(s.conversations).set({ updatedAt: now }).where(conditions);
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(db: any, s: ReturnType<typeof createSchema>): MemoryStore {
  function scopeCondition(scopeId?: string) {
    return scopeId ? eq(s.memoryEntries.scopeId, scopeId) : undefined;
  }

  return {
    async listNamespaces(scopeId?) {
      const cond = scopeCondition(scopeId);
      const rows = await db
        .selectDistinct({ namespaceId: s.memoryEntries.namespaceId })
        .from(s.memoryEntries)
        .where(cond);
      return rows.map((r: any) => r.namespaceId);
    },

    async listEntries(namespaceId, scopeId?) {
      const cond = scopeId
        ? and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.scopeId, scopeId))
        : eq(s.memoryEntries.namespaceId, namespaceId);
      const rows = await db.select().from(s.memoryEntries).where(cond);
      return rows.map((r: any) => ({
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      // Check for existing
      const cond = and(
        eq(s.memoryEntries.namespaceId, namespaceId),
        eq(s.memoryEntries.key, key),
        scopeId ? eq(s.memoryEntries.scopeId, scopeId) : isNull(s.memoryEntries.scopeId),
      );
      const existing = await db.select().from(s.memoryEntries).where(cond);
      if (existing.length) {
        await db.update(s.memoryEntries).set({ value, context, updatedAt: now }).where(cond);
        return { key, value, context, createdAt: existing[0].createdAt instanceof Date ? existing[0].createdAt.toISOString() : existing[0].createdAt, updatedAt: now };
      }
      await db.insert(s.memoryEntries).values({ namespaceId, key, value, context, scopeId: scopeId ?? null, createdAt: now, updatedAt: now });
      return { key, value, context, createdAt: now, updatedAt: now };
    },

    async getEntry(namespaceId, key, scopeId?) {
      const cond = scopeId
        ? and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.key, key), eq(s.memoryEntries.scopeId, scopeId))
        : and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.key, key));
      const rows = await db.select().from(s.memoryEntries).where(cond);
      if (!rows.length) return null;
      const r = rows[0];
      return { key: r.key, value: r.value, context: r.context, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt, updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const cond = scopeId
        ? and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.key, key), eq(s.memoryEntries.scopeId, scopeId))
        : and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.key, key));
      const result = await db.delete(s.memoryEntries).where(cond);
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      const cond = scopeId
        ? and(eq(s.memoryEntries.namespaceId, namespaceId), eq(s.memoryEntries.scopeId, scopeId))
        : eq(s.memoryEntries.namespaceId, namespaceId);
      await db.delete(s.memoryEntries).where(cond);
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const cond = scopeId
        ? and(inArray(s.memoryEntries.namespaceId, ids), eq(s.memoryEntries.scopeId, scopeId))
        : inArray(s.memoryEntries.namespaceId, ids);
      const rows = await db.select().from(s.memoryEntries).where(cond);
      return rows.map((r: any) => ({
        namespace: r.namespaceId,
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      }));
    },
  };
}

// ── Skill Store ──

function createSkillStore(db: any, s: ReturnType<typeof createSchema>): SkillStore {
  function rowToSkill(r: any): Skill {
    return {
      name: r.name,
      description: r.description ?? "",
      tags: typeof r.tags === "string" ? jsonParse(r.tags, []) : r.tags ?? [],
      phase: (r.phase ?? "both") as SkillPhase,
      content: r.content ?? "",
      rawContent: r.rawContent ?? "",
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    };
  }

  return {
    async listSkills() {
      const rows = await db.select().from(s.skills).orderBy(asc(s.skills.name));
      return rows.map((r: any) => ({
        name: r.name,
        description: r.description ?? "",
        tags: typeof r.tags === "string" ? jsonParse(r.tags, []) : r.tags ?? [],
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const rows = await db.select().from(s.skills).where(eq(s.skills.name, name));
      return rows.length ? rowToSkill(rows[0]) : null;
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await db.insert(s.skills).values({
        name,
        description: (meta.description as string) ?? "",
        tags: JSON.stringify((meta.tags as string[]) ?? []),
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
      await db.update(s.skills).set({
        description: (meta.description as string) ?? "",
        tags: JSON.stringify((meta.tags as string[]) ?? []),
        phase: (meta.phase as string) ?? "both",
        content: body,
        rawContent: rawContent,
        updatedAt: now,
      }).where(eq(s.skills.name, name));
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const result = await db.delete(s.skills).where(eq(s.skills.name, name));
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },

    async getSkillSummaries() {
      const rows = await db.select({ name: s.skills.name, description: s.skills.description }).from(s.skills).orderBy(asc(s.skills.name));
      if (!rows.length) return "";
      return rows.map((r: any) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(db: any, s: ReturnType<typeof createSchema>): TaskStore {
  function rowToTask(r: any): Task {
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(s.tasks).values({ id, title, status: "todo", createdAt: now, updatedAt: now });
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      const rows = await db.select().from(s.tasks).orderBy(asc(s.tasks.createdAt));
      return rows.map(rowToTask);
    },

    async updateTask(id, updates) {
      const now = new Date().toISOString();
      const setValues: any = { updatedAt: now };
      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.status !== undefined) setValues.status = updates.status;
      await db.update(s.tasks).set(setValues).where(eq(s.tasks.id, id));
      const rows = await db.select().from(s.tasks).where(eq(s.tasks.id, id));
      return rowToTask(rows[0]);
    },

    async deleteTask(id) {
      const result = await db.delete(s.tasks).where(eq(s.tasks.id, id));
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(db: any, s: ReturnType<typeof createSchema>): PromptStore {
  return {
    async loadOverrides() {
      const rows = await db.select().from(s.promptOverrides);
      const result: Record<string, PromptOverride> = {};
      for (const r of rows) {
        result[r.name] = { prompt: r.prompt, updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      const existing = await db.select().from(s.promptOverrides).where(eq(s.promptOverrides.name, name));
      if (existing.length) {
        await db.update(s.promptOverrides).set({ prompt, updatedAt: now }).where(eq(s.promptOverrides.name, name));
      } else {
        await db.insert(s.promptOverrides).values({ name, prompt, updatedAt: now });
      }
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const result = await db.delete(s.promptOverrides).where(eq(s.promptOverrides.name, name));
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(db: any, s: ReturnType<typeof createSchema>): CommandStore {
  function rowToCommand(r: any): CommandRegistration {
    return {
      name: r.name,
      description: r.description ?? "",
      system: r.system ?? "",
      tools: typeof r.tools === "string" ? jsonParse(r.tools, []) : r.tools ?? [],
      model: r.model ?? undefined,
      format: r.format ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const rows = await db.select().from(s.commands).where(eq(s.commands.scopeId, scopeId ?? "")).orderBy(asc(s.commands.name));
      return rows.map(rowToCommand);
    },

    async get(name, scopeId?) {
      const rows = await db.select().from(s.commands).where(and(eq(s.commands.name, name), eq(s.commands.scopeId, scopeId ?? "")));
      return rows.length ? rowToCommand(rows[0]) : undefined;
    },

    async save(command, scopeId?) {
      const existing = await db.select().from(s.commands).where(and(eq(s.commands.name, command.name), eq(s.commands.scopeId, scopeId ?? "")));
      if (existing.length) {
        await db.update(s.commands).set({
          description: command.description,
          system: command.system,
          tools: JSON.stringify(command.tools ?? []),
          model: command.model ?? null,
          format: command.format ?? null,
        }).where(and(eq(s.commands.name, command.name), eq(s.commands.scopeId, scopeId ?? "")));
      } else {
        await db.insert(s.commands).values({
          name: command.name,
          scopeId: scopeId ?? "",
          description: command.description,
          system: command.system,
          tools: JSON.stringify(command.tools ?? []),
          model: command.model ?? null,
          format: command.format ?? null,
        });
      }
    },

    async delete(name, scopeId?) {
      await db.delete(s.commands).where(and(eq(s.commands.name, name), eq(s.commands.scopeId, scopeId ?? "")));
    },
  };
}

// ── Cron Store ──

function createCronStore(db: any, s: ReturnType<typeof createSchema>): CronStore {
  function rowToCronJob(r: any): CronJob {
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      schedule: r.schedule ?? undefined,
      runAt: r.runAt ? (r.runAt instanceof Date ? r.runAt.toISOString() : r.runAt) : undefined,
      agentName: r.agentName,
      input: r.input ?? "",
      model: r.model ?? undefined,
      timezone: r.timezone ?? "UTC",
      enabled: Boolean(r.enabled),
      nextRun: r.nextRun ? (r.nextRun instanceof Date ? r.nextRun.toISOString() : r.nextRun) : undefined,
      lastRun: r.lastRun ? (r.lastRun instanceof Date ? r.lastRun.toISOString() : r.lastRun) : undefined,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    };
  }

  function rowToExecution(r: any): CronExecution {
    return {
      id: r.id,
      cronId: r.cronId,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
      completedAt: r.completedAt ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : r.completedAt) : undefined,
      status: r.status,
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(s.cronJobs).values({
        id, name: input.name, description: input.description,
        schedule: input.schedule ?? null, runAt: input.runAt ?? null,
        agentName: input.agentName, input: input.input,
        model: input.model ?? null, timezone: input.timezone ?? "UTC",
        enabled: input.enabled, nextRun: input.nextRun ?? null,
        lastRun: input.lastRun ?? null, scopeId: scopeId ?? null,
        createdAt: now, updatedAt: now,
      });
      const rows = await db.select().from(s.cronJobs).where(eq(s.cronJobs.id, id));
      return rowToCronJob(rows[0]);
    },

    async get(id, scopeId?) {
      const cond = scopeId
        ? and(eq(s.cronJobs.id, id), eq(s.cronJobs.scopeId, scopeId))
        : eq(s.cronJobs.id, id);
      const rows = await db.select().from(s.cronJobs).where(cond);
      return rows.length ? rowToCronJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const cond = scopeId ? eq(s.cronJobs.scopeId, scopeId) : undefined;
      const rows = await db.select().from(s.cronJobs).where(cond).orderBy(asc(s.cronJobs.createdAt));
      return rows.map(rowToCronJob);
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
      const cond = scopeId
        ? and(eq(s.cronJobs.id, id), eq(s.cronJobs.scopeId, scopeId))
        : eq(s.cronJobs.id, id);
      await db.update(s.cronJobs).set(setValues).where(cond);
      const rows = await db.select().from(s.cronJobs).where(eq(s.cronJobs.id, id));
      return rowToCronJob(rows[0]);
    },

    async delete(id, scopeId?) {
      const cond = scopeId
        ? and(eq(s.cronJobs.id, id), eq(s.cronJobs.scopeId, scopeId))
        : eq(s.cronJobs.id, id);
      const result = await db.delete(s.cronJobs).where(cond);
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      await db.insert(s.cronExecutions).values({
        id, cronId: input.cronId, startedAt: input.startedAt,
        completedAt: input.completedAt ?? null, status: input.status,
        summary: input.summary ?? null, error: input.error ?? null,
        scopeId: scopeId ?? null,
      });
      const rows = await db.select().from(s.cronExecutions).where(eq(s.cronExecutions.id, id));
      return rowToExecution(rows[0]);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const cond = scopeId
        ? and(eq(s.cronExecutions.cronId, cronId), eq(s.cronExecutions.scopeId, scopeId))
        : eq(s.cronExecutions.cronId, cronId);
      const rows = await db.select().from(s.cronExecutions).where(cond).orderBy(desc(s.cronExecutions.startedAt)).limit(limit);
      return rows.map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const setValues: any = {};
      if (updates.completedAt !== undefined) setValues.completedAt = updates.completedAt;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.summary !== undefined) setValues.summary = updates.summary;
      if (updates.error !== undefined) setValues.error = updates.error;
      if (Object.keys(setValues).length) {
        const cond = scopeId
          ? and(eq(s.cronExecutions.id, id), eq(s.cronExecutions.scopeId, scopeId))
          : eq(s.cronExecutions.id, id);
        await db.update(s.cronExecutions).set(setValues).where(cond);
      }
      const rows = await db.select().from(s.cronExecutions).where(eq(s.cronExecutions.id, id));
      return rowToExecution(rows[0]);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const cond = scopeId
        ? and(
            eq(s.cronJobs.enabled, true),
            eq(s.cronJobs.scopeId, scopeId),
            or(
              lte(s.cronJobs.nextRun, iso),
              and(lte(s.cronJobs.runAt, iso), isNull(s.cronJobs.lastRun)),
            ),
          )
        : and(
            eq(s.cronJobs.enabled, true),
            or(
              lte(s.cronJobs.nextRun, iso),
              and(lte(s.cronJobs.runAt, iso), isNull(s.cronJobs.lastRun)),
            ),
          );
      return (await db.select().from(s.cronJobs).where(cond)).map(rowToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(db: any, s: ReturnType<typeof createSchema>): JobStore {
  function rowToJob(r: any): Job {
    return {
      id: r.id,
      agentName: r.agentName,
      input: r.input ?? "",
      conversationId: r.conversationId,
      scopeId: r.scopeId ?? undefined,
      status: r.status,
      result: r.result ?? undefined,
      error: r.error ?? undefined,
      usage: r.usagePromptTokens != null
        ? { promptTokens: r.usagePromptTokens, completionTokens: r.usageCompletionTokens, totalTokens: r.usageTotalTokens }
        : undefined,
      toolsUsed: typeof r.toolsUsed === "string" ? jsonParse(r.toolsUsed, undefined) : r.toolsUsed ?? undefined,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      startedAt: r.startedAt ? (r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt) : undefined,
      completedAt: r.completedAt ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : r.completedAt) : undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(s.jobs).values({
        id, agentName: job.agentName, input: job.input,
        conversationId: job.conversationId, scopeId: job.scopeId ?? null,
        status: job.status, result: job.result ?? null, error: job.error ?? null,
        usagePromptTokens: job.usage?.promptTokens ?? null,
        usageCompletionTokens: job.usage?.completionTokens ?? null,
        usageTotalTokens: job.usage?.totalTokens ?? null,
        toolsUsed: job.toolsUsed ? JSON.stringify(job.toolsUsed) : null,
        createdAt: now, startedAt: job.startedAt ?? null, completedAt: job.completedAt ?? null,
      });
      const rows = await db.select().from(s.jobs).where(eq(s.jobs.id, id));
      return rowToJob(rows[0]);
    },

    async get(id, scopeId?) {
      const cond = scopeId
        ? and(eq(s.jobs.id, id), eq(s.jobs.scopeId, scopeId))
        : eq(s.jobs.id, id);
      const rows = await db.select().from(s.jobs).where(cond);
      return rows.length ? rowToJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const cond = scopeId ? eq(s.jobs.scopeId, scopeId) : undefined;
      const rows = await db.select().from(s.jobs).where(cond).orderBy(desc(s.jobs.createdAt));
      return rows.map(rowToJob);
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
      if (updates.usage) {
        setValues.usagePromptTokens = updates.usage.promptTokens;
        setValues.usageCompletionTokens = updates.usage.completionTokens;
        setValues.usageTotalTokens = updates.usage.totalTokens;
      }
      if (updates.toolsUsed !== undefined) setValues.toolsUsed = JSON.stringify(updates.toolsUsed);
      if (Object.keys(setValues).length) {
        await db.update(s.jobs).set(setValues).where(eq(s.jobs.id, id));
      }
      const rows = await db.select().from(s.jobs).where(eq(s.jobs.id, id));
      return rowToJob(rows[0]);
    },

    async delete(id, scopeId?) {
      const cond = scopeId
        ? and(eq(s.jobs.id, id), eq(s.jobs.scopeId, scopeId))
        : eq(s.jobs.id, id);
      const result = await db.delete(s.jobs).where(cond);
      return (result.rowCount ?? result.changes ?? 0) > 0;
    },
  };
}

// ── Factory ──

export async function createDrizzleStorage(config: DrizzleConfig): Promise<StorageProvider> {
  const { db, dialect } = config;
  const p = config.tablePrefix ?? "kitn_";

  const schema = createSchema(p);

  if (config.autoMigrate !== false) {
    await runMigrations(db, dialect, p);
  }

  return {
    conversations: createConversationStore(db, schema),
    memory: createMemoryStore(db, schema),
    skills: createSkillStore(db, schema),
    tasks: createTaskStore(db, schema),
    prompts: createPromptStore(db, schema),
    commands: createCommandStore(db, schema),
    crons: createCronStore(db, schema),
    jobs: createJobStore(db, schema),
  };
}
