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

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = any>(column?: string): Promise<T | null>;
  run(): Promise<{ meta: { changes: number }; success: boolean }>;
  all<T = any>(): Promise<{ results: T[]; success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = any>(statements: D1PreparedStatement[]): Promise<Array<{ results: T[]; success: boolean }>>;
  exec(query: string): Promise<void>;
}

interface D1Config {
  database: D1Database;
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

// ── Migrations ──

async function runMigrations(db: D1Database, p: string): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}conversations (id TEXT PRIMARY KEY, scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, timestamp TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}memory_entries (namespace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace_id, key, COALESCE(scope_id, '')))`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}skills (name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', phase TEXT NOT NULL DEFAULT 'both', content TEXT NOT NULL DEFAULT '', raw_content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (name TEXT PRIMARY KEY, prompt TEXT NOT NULL, updated_at TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}commands (name TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', system TEXT NOT NULL DEFAULT '', tools TEXT NOT NULL DEFAULT '[]', model TEXT, format TEXT, PRIMARY KEY (name, scope_id))`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}cron_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', schedule TEXT, run_at TEXT, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', model TEXT, timezone TEXT DEFAULT 'UTC', enabled INTEGER NOT NULL DEFAULT 1, next_run TEXT, last_run TEXT, scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}cron_executions (id TEXT PRIMARY KEY, cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, summary TEXT, error TEXT, scope_id TEXT)`).bind(),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${p}jobs (id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL, scope_id TEXT, status TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, usage_prompt_tokens INTEGER, usage_completion_tokens INTEGER, usage_total_tokens INTEGER, tools_used TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)`).bind(),
  ]);
}

// ── Conversation Store ──

function createConversationStore(db: D1Database, p: string): ConversationStore {
  return {
    async get(id, scopeId?) {
      const row = await db.prepare(
        `SELECT * FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).first();
      if (!row) return null;
      const { results: messages } = await db.prepare(
        `SELECT role, content, metadata, timestamp FROM ${p}conversation_messages WHERE conversation_id = ? ORDER BY id`,
      ).bind(id).all();
      return {
        id: (row as any).id,
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          metadata: jsonParse(m.metadata, undefined),
        })),
        createdAt: (row as any).created_at,
        updatedAt: (row as any).updated_at,
      };
    },

    async list(scopeId?) {
      const { results } = await db.prepare(
        `SELECT c.id, c.updated_at, COUNT(m.id) AS message_count
         FROM ${p}conversations c
         LEFT JOIN ${p}conversation_messages m ON m.conversation_id = c.id
         WHERE (? IS NULL OR c.scope_id = ?)
         GROUP BY c.id
         ORDER BY c.updated_at DESC`,
      ).bind(scopeId ?? null, scopeId ?? null).all();
      return results.map((r: any) => ({
        id: r.id,
        messageCount: Number(r.message_count),
        updatedAt: r.updated_at,
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(id, scopeId ?? null, now, now).run();
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      const existing = await db.prepare(`SELECT id FROM ${p}conversations WHERE id = ?`).bind(id).first();
      if (!existing) {
        await db.prepare(
          `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ).bind(id, scopeId ?? null, now, now).run();
      } else {
        await db.prepare(`UPDATE ${p}conversations SET updated_at = ? WHERE id = ?`).bind(now, id).run();
      }
      await db.prepare(
        `INSERT INTO ${p}conversation_messages (conversation_id, role, content, metadata, timestamp) VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, message.role, message.content, message.metadata ? JSON.stringify(message.metadata) : null, message.timestamp).run();
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const { meta } = await db.prepare(
        `DELETE FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).run();
      return meta.changes > 0;
    },

    async clear(id, scopeId?) {
      const now = new Date().toISOString();
      await db.prepare(`DELETE FROM ${p}conversation_messages WHERE conversation_id = ?`).bind(id).run();
      await db.prepare(
        `UPDATE ${p}conversations SET updated_at = ? WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(now, id, scopeId ?? null, scopeId ?? null).run();
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(db: D1Database, p: string): MemoryStore {
  return {
    async listNamespaces(scopeId?) {
      const { results } = await db.prepare(
        `SELECT DISTINCT namespace_id FROM ${p}memory_entries WHERE (? IS NULL OR scope_id = ?)`,
      ).bind(scopeId ?? null, scopeId ?? null).all();
      return results.map((r: any) => r.namespace_id);
    },

    async listEntries(namespaceId, scopeId?) {
      const { results } = await db.prepare(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(namespaceId, scopeId ?? null, scopeId ?? null).all();
      return results.map((r: any) => ({
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      const existing = await db.prepare(
        `SELECT created_at FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
      ).bind(namespaceId, key, scopeId ?? "").first();
      if (existing) {
        await db.prepare(
          `UPDATE ${p}memory_entries SET value = ?, context = ?, updated_at = ?
           WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
        ).bind(value, context, now, namespaceId, key, scopeId ?? "").run();
        return { key, value, context, createdAt: (existing as any).created_at, updatedAt: now };
      } else {
        await db.prepare(
          `INSERT INTO ${p}memory_entries (namespace_id, key, value, context, scope_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(namespaceId, key, value, context, scopeId ?? null, now, now).run();
        return { key, value, context, createdAt: now, updatedAt: now };
      }
    },

    async getEntry(namespaceId, key, scopeId?) {
      const row = await db.prepare(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(namespaceId, key, scopeId ?? null, scopeId ?? null).first();
      if (!row) return null;
      const r = row as any;
      return { key: r.key, value: r.value, context: r.context, createdAt: r.created_at, updatedAt: r.updated_at };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const { meta } = await db.prepare(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(namespaceId, key, scopeId ?? null, scopeId ?? null).run();
      return meta.changes > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      await db.prepare(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(namespaceId, scopeId ?? null, scopeId ?? null).run();
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const { results } = await db.prepare(
        `SELECT namespace_id, key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id IN (${placeholders}) AND (? IS NULL OR scope_id = ?)`,
      ).bind(...ids, scopeId ?? null, scopeId ?? null).all();
      return results.map((r: any) => ({
        namespace: r.namespace_id,
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
  };
}

// ── Skill Store ──

function createSkillStore(db: D1Database, p: string): SkillStore {
  function rowToSkill(r: any): Skill {
    return {
      name: r.name,
      description: r.description,
      tags: jsonParse(r.tags, []),
      phase: (r.phase ?? "both") as SkillPhase,
      content: r.content,
      rawContent: r.raw_content,
      updatedAt: r.updated_at,
    };
  }

  return {
    async listSkills() {
      const { results } = await db.prepare(`SELECT name, description, tags, phase FROM ${p}skills ORDER BY name`).bind().all();
      return results.map((r: any) => ({
        name: r.name,
        description: r.description,
        tags: jsonParse(r.tags, []),
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const row = await db.prepare(`SELECT * FROM ${p}skills WHERE name = ?`).bind(name).first();
      return row ? rowToSkill(row) : null;
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO ${p}skills (name, description, tags, phase, content, raw_content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(name, (meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now).run();
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await db.prepare(
        `UPDATE ${p}skills SET description = ?, tags = ?, phase = ?, content = ?, raw_content = ?, updated_at = ? WHERE name = ?`,
      ).bind((meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now, name).run();
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const { meta } = await db.prepare(`DELETE FROM ${p}skills WHERE name = ?`).bind(name).run();
      return meta.changes > 0;
    },

    async getSkillSummaries() {
      const { results } = await db.prepare(`SELECT name, description FROM ${p}skills ORDER BY name`).bind().all();
      if (!results.length) return "";
      return results.map((r: any) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(db: D1Database, p: string): TaskStore {
  function rowToTask(r: any): Task {
    return { id: r.id, title: r.title, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO ${p}tasks (id, title, status, created_at, updated_at) VALUES (?, ?, 'todo', ?, ?)`,
      ).bind(id, title, now, now).run();
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      const { results } = await db.prepare(`SELECT * FROM ${p}tasks ORDER BY created_at`).bind().all();
      return results.map(rowToTask);
    },

    async updateTask(id, updates) {
      const row = await db.prepare(`SELECT * FROM ${p}tasks WHERE id = ?`).bind(id).first() as any;
      const now = new Date().toISOString();
      const newTitle = updates.title ?? row.title;
      const newStatus = updates.status ?? row.status;
      await db.prepare(`UPDATE ${p}tasks SET title = ?, status = ?, updated_at = ? WHERE id = ?`).bind(newTitle, newStatus, now, id).run();
      return { id, title: newTitle, status: newStatus, createdAt: row.created_at, updatedAt: now };
    },

    async deleteTask(id) {
      const { meta } = await db.prepare(`DELETE FROM ${p}tasks WHERE id = ?`).bind(id).run();
      return meta.changes > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(db: D1Database, p: string): PromptStore {
  return {
    async loadOverrides() {
      const { results } = await db.prepare(`SELECT name, prompt, updated_at FROM ${p}prompt_overrides`).bind().all();
      const result: Record<string, PromptOverride> = {};
      for (const r of results as any[]) {
        result[r.name] = { prompt: r.prompt, updatedAt: r.updated_at };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      const existing = await db.prepare(`SELECT name FROM ${p}prompt_overrides WHERE name = ?`).bind(name).first();
      if (existing) {
        await db.prepare(`UPDATE ${p}prompt_overrides SET prompt = ?, updated_at = ? WHERE name = ?`).bind(prompt, now, name).run();
      } else {
        await db.prepare(`INSERT INTO ${p}prompt_overrides (name, prompt, updated_at) VALUES (?, ?, ?)`).bind(name, prompt, now).run();
      }
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { meta } = await db.prepare(`DELETE FROM ${p}prompt_overrides WHERE name = ?`).bind(name).run();
      return meta.changes > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(db: D1Database, p: string): CommandStore {
  function rowToCommand(r: any): CommandRegistration {
    return {
      name: r.name,
      description: r.description,
      system: r.system,
      tools: jsonParse(r.tools, []),
      model: r.model ?? undefined,
      format: r.format ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const { results } = await db.prepare(`SELECT * FROM ${p}commands WHERE scope_id = ? ORDER BY name`).bind(scopeId ?? "").all();
      return results.map(rowToCommand);
    },

    async get(name, scopeId?) {
      const row = await db.prepare(`SELECT * FROM ${p}commands WHERE name = ? AND scope_id = ?`).bind(name, scopeId ?? "").first();
      return row ? rowToCommand(row) : undefined;
    },

    async save(command, scopeId?) {
      const existing = await db.prepare(`SELECT name FROM ${p}commands WHERE name = ? AND scope_id = ?`).bind(command.name, scopeId ?? "").first();
      if (existing) {
        await db.prepare(
          `UPDATE ${p}commands SET description = ?, system = ?, tools = ?, model = ?, format = ? WHERE name = ? AND scope_id = ?`,
        ).bind(command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null, command.name, scopeId ?? "").run();
      } else {
        await db.prepare(
          `INSERT INTO ${p}commands (name, scope_id, description, system, tools, model, format) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(command.name, scopeId ?? "", command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null).run();
      }
    },

    async delete(name, scopeId?) {
      await db.prepare(`DELETE FROM ${p}commands WHERE name = ? AND scope_id = ?`).bind(name, scopeId ?? "").run();
    },
  };
}

// ── Cron Store ──

function createCronStore(db: D1Database, p: string): CronStore {
  function rowToCronJob(r: any): CronJob {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      schedule: r.schedule ?? undefined,
      runAt: r.run_at ?? undefined,
      agentName: r.agent_name,
      input: r.input,
      model: r.model ?? undefined,
      timezone: r.timezone ?? "UTC",
      enabled: Boolean(r.enabled),
      nextRun: r.next_run ?? undefined,
      lastRun: r.last_run ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  function rowToExecution(r: any): CronExecution {
    return {
      id: r.id,
      cronId: r.cron_id,
      startedAt: r.started_at,
      completedAt: r.completed_at ?? undefined,
      status: r.status,
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO ${p}cron_jobs (id, name, description, schedule, run_at, agent_name, input, model, timezone, enabled, next_run, last_run, scope_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, input.name, input.description, input.schedule ?? null, input.runAt ?? null, input.agentName, input.input, input.model ?? null, input.timezone ?? "UTC", input.enabled ? 1 : 0, input.nextRun ?? null, input.lastRun ?? null, scopeId ?? null, now, now).run();
      const row = await db.prepare(`SELECT * FROM ${p}cron_jobs WHERE id = ?`).bind(id).first();
      return rowToCronJob(row);
    },

    async get(id, scopeId?) {
      const row = await db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).first();
      return row ? rowToCronJob(row) : null;
    },

    async list(scopeId?) {
      const { results } = await db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at`,
      ).bind(scopeId ?? null, scopeId ?? null).all();
      return results.map(rowToCronJob);
    },

    async update(id, updates, scopeId?) {
      const row = await db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).first() as any;
      const u: any = { ...updates };
      const now = u.updatedAt ?? new Date().toISOString();
      await db.prepare(
        `UPDATE ${p}cron_jobs SET name=?, description=?, schedule=?, run_at=?, agent_name=?, input=?, model=?, timezone=?, enabled=?, next_run=?, last_run=?, updated_at=? WHERE id=?`,
      ).bind(
        u.name ?? row.name, u.description ?? row.description, u.schedule ?? row.schedule ?? null,
        u.runAt ?? row.run_at ?? null, u.agentName ?? row.agent_name, u.input ?? row.input,
        u.model ?? row.model ?? null, u.timezone ?? row.timezone ?? "UTC",
        (u.enabled !== undefined ? u.enabled : Boolean(row.enabled)) ? 1 : 0,
        u.nextRun ?? row.next_run ?? null, u.lastRun ?? row.last_run ?? null, now, id,
      ).run();
      const updated = await db.prepare(`SELECT * FROM ${p}cron_jobs WHERE id = ?`).bind(id).first();
      return rowToCronJob(updated);
    },

    async delete(id, scopeId?) {
      const { meta } = await db.prepare(
        `DELETE FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).run();
      return meta.changes > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO ${p}cron_executions (id, cron_id, started_at, completed_at, status, summary, error, scope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, input.cronId, input.startedAt, input.completedAt ?? null, input.status, input.summary ?? null, input.error ?? null, scopeId ?? null).run();
      const row = await db.prepare(`SELECT * FROM ${p}cron_executions WHERE id = ?`).bind(id).first();
      return rowToExecution(row);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const { results } = await db.prepare(
        `SELECT * FROM ${p}cron_executions WHERE cron_id = ? AND (? IS NULL OR scope_id = ?) ORDER BY started_at DESC LIMIT ?`,
      ).bind(cronId, scopeId ?? null, scopeId ?? null, limit).all();
      return results.map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const row = await db.prepare(
        `SELECT * FROM ${p}cron_executions WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).first() as any;
      const u: any = { ...updates };
      await db.prepare(
        `UPDATE ${p}cron_executions SET completed_at=?, status=?, summary=?, error=? WHERE id=?`,
      ).bind(u.completedAt ?? row.completed_at ?? null, u.status ?? row.status, u.summary ?? row.summary ?? null, u.error ?? row.error ?? null, id).run();
      const updated = await db.prepare(`SELECT * FROM ${p}cron_executions WHERE id = ?`).bind(id).first();
      return rowToExecution(updated);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const { results } = await db.prepare(
        `SELECT * FROM ${p}cron_jobs
         WHERE enabled = 1 AND (? IS NULL OR scope_id = ?)
           AND (next_run <= ? OR (run_at <= ? AND last_run IS NULL))
         ORDER BY COALESCE(next_run, run_at)`,
      ).bind(scopeId ?? null, scopeId ?? null, iso, iso).all();
      return results.map(rowToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(db: D1Database, p: string): JobStore {
  function rowToJob(r: any): Job {
    return {
      id: r.id,
      agentName: r.agent_name,
      input: r.input,
      conversationId: r.conversation_id,
      scopeId: r.scope_id ?? undefined,
      status: r.status,
      result: r.result ?? undefined,
      error: r.error ?? undefined,
      usage: r.usage_prompt_tokens != null
        ? { promptTokens: r.usage_prompt_tokens, completionTokens: r.usage_completion_tokens, totalTokens: r.usage_total_tokens }
        : undefined,
      toolsUsed: jsonParse(r.tools_used, undefined),
      createdAt: r.created_at,
      startedAt: r.started_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO ${p}jobs (id, agent_name, input, conversation_id, scope_id, status, result, error,
          usage_prompt_tokens, usage_completion_tokens, usage_total_tokens, tools_used, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, job.agentName, job.input, job.conversationId, job.scopeId ?? null, job.status, job.result ?? null, job.error ?? null, job.usage?.promptTokens ?? null, job.usage?.completionTokens ?? null, job.usage?.totalTokens ?? null, job.toolsUsed ? JSON.stringify(job.toolsUsed) : null, now, job.startedAt ?? null, job.completedAt ?? null).run();
      const row = await db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).bind(id).first();
      return rowToJob(row);
    },

    async get(id, scopeId?) {
      const row = await db.prepare(
        `SELECT * FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).first();
      return row ? rowToJob(row) : null;
    },

    async list(scopeId?) {
      const { results } = await db.prepare(
        `SELECT * FROM ${p}jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at DESC`,
      ).bind(scopeId ?? null, scopeId ?? null).all();
      return results.map(rowToJob);
    },

    async update(id, updates) {
      const row = await db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).bind(id).first() as any;
      const u: any = { ...updates };
      const agentName = u.agentName ?? row.agent_name;
      const input = u.input ?? row.input;
      const conversationId = u.conversationId ?? row.conversation_id;
      const scopeId = u.scopeId ?? row.scope_id;
      const status = u.status ?? row.status;
      const result = u.result ?? row.result;
      const error = u.error ?? row.error;
      const startedAt = u.startedAt ?? row.started_at;
      const completedAt = u.completedAt ?? row.completed_at;
      const promptTokens = u.usage?.promptTokens ?? row.usage_prompt_tokens;
      const completionTokens = u.usage?.completionTokens ?? row.usage_completion_tokens;
      const totalTokens = u.usage?.totalTokens ?? row.usage_total_tokens;
      const toolsUsed = u.toolsUsed !== undefined ? JSON.stringify(u.toolsUsed) : row.tools_used;
      await db.prepare(
        `UPDATE ${p}jobs SET agent_name=?, input=?, conversation_id=?, scope_id=?, status=?, result=?, error=?,
          usage_prompt_tokens=?, usage_completion_tokens=?, usage_total_tokens=?, tools_used=?, started_at=?, completed_at=? WHERE id=?`,
      ).bind(agentName, input, conversationId, scopeId, status, result, error, promptTokens, completionTokens, totalTokens, toolsUsed, startedAt, completedAt, id).run();
      const updated = await db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).bind(id).first();
      return rowToJob(updated);
    },

    async delete(id, scopeId?) {
      const { meta } = await db.prepare(
        `DELETE FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).bind(id, scopeId ?? null, scopeId ?? null).run();
      return meta.changes > 0;
    },
  };
}

// ── Factory ──

export async function createD1Storage(config: D1Config): Promise<StorageProvider> {
  const { database: db } = config;
  const p = config.tablePrefix ?? "kitn_";

  if (config.autoMigrate !== false) {
    await runMigrations(db, p);
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
