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

interface SqliteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
  };
  exec(sql: string): void;
}

interface SqliteConfig {
  database: SqliteDatabase;
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

function runMigrations(db: SqliteDatabase, p: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}conversations (
      id TEXT PRIMARY KEY,
      scope_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      timestamp TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}memory_entries (
      namespace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      scope_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace_id, key, COALESCE(scope_id, ''))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      phase TEXT NOT NULL DEFAULT 'both',
      content TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (
      name TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}commands (
      name TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      system TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      format TEXT,
      PRIMARY KEY (name, scope_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      schedule TEXT,
      run_at TEXT,
      agent_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      model TEXT,
      timezone TEXT DEFAULT 'UTC',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run TEXT,
      last_run TEXT,
      scope_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}cron_executions (
      id TEXT PRIMARY KEY,
      cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT,
      scope_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}jobs (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL,
      scope_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      error TEXT,
      usage_prompt_tokens INTEGER,
      usage_completion_tokens INTEGER,
      usage_total_tokens INTEGER,
      tools_used TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    )
  `);
}

// ── Conversation Store ──

function createConversationStore(db: SqliteDatabase, p: string): ConversationStore {
  return {
    async get(id, scopeId?) {
      const row = db.prepare(
        `SELECT * FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(id, scopeId ?? null, scopeId ?? null);
      if (!row) return null;
      const messages = db.prepare(
        `SELECT role, content, metadata, timestamp FROM ${p}conversation_messages WHERE conversation_id = ? ORDER BY id`,
      ).all(id);
      return {
        id: row.id,
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          metadata: jsonParse(m.metadata, undefined),
        })),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    async list(scopeId?) {
      const rows = db.prepare(
        `SELECT c.id, c.updated_at, COUNT(m.id) AS message_count
         FROM ${p}conversations c
         LEFT JOIN ${p}conversation_messages m ON m.conversation_id = c.id
         WHERE (? IS NULL OR c.scope_id = ?)
         GROUP BY c.id
         ORDER BY c.updated_at DESC`,
      ).all(scopeId ?? null, scopeId ?? null);
      return rows.map((r: any) => ({
        id: r.id,
        messageCount: r.message_count,
        updatedAt: r.updated_at,
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run(id, scopeId ?? null, now, now);
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      // Upsert conversation
      const existing = db.prepare(`SELECT id FROM ${p}conversations WHERE id = ?`).get(id);
      if (!existing) {
        db.prepare(
          `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ).run(id, scopeId ?? null, now, now);
      } else {
        db.prepare(`UPDATE ${p}conversations SET updated_at = ? WHERE id = ?`).run(now, id);
      }
      // Insert message
      db.prepare(
        `INSERT INTO ${p}conversation_messages (conversation_id, role, content, metadata, timestamp) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, message.role, message.content, message.metadata ? JSON.stringify(message.metadata) : null, message.timestamp);
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const { changes } = db.prepare(
        `DELETE FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(id, scopeId ?? null, scopeId ?? null);
      return changes > 0;
    },

    async clear(id, scopeId?) {
      db.prepare(`DELETE FROM ${p}conversation_messages WHERE conversation_id = ?`).run(id);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE ${p}conversations SET updated_at = ? WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(now, id, scopeId ?? null, scopeId ?? null);
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(db: SqliteDatabase, p: string): MemoryStore {
  return {
    async listNamespaces(scopeId?) {
      const rows = db.prepare(
        `SELECT DISTINCT namespace_id FROM ${p}memory_entries WHERE (? IS NULL OR scope_id = ?)`,
      ).all(scopeId ?? null, scopeId ?? null);
      return rows.map((r: any) => r.namespace_id);
    },

    async listEntries(namespaceId, scopeId?) {
      const rows = db.prepare(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
      ).all(namespaceId, scopeId ?? null, scopeId ?? null);
      return rows.map((r: any) => ({
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      const existing = db.prepare(
        `SELECT created_at FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
      ).get(namespaceId, key, scopeId ?? "");
      if (existing) {
        db.prepare(
          `UPDATE ${p}memory_entries SET value = ?, context = ?, updated_at = ?
           WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
        ).run(value, context, now, namespaceId, key, scopeId ?? "");
        return { key, value, context, createdAt: (existing as any).created_at, updatedAt: now };
      } else {
        db.prepare(
          `INSERT INTO ${p}memory_entries (namespace_id, key, value, context, scope_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(namespaceId, key, value, context, scopeId ?? null, now, now);
        return { key, value, context, createdAt: now, updatedAt: now };
      }
    },

    async getEntry(namespaceId, key, scopeId?) {
      const row = db.prepare(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(namespaceId, key, scopeId ?? null, scopeId ?? null) as any;
      if (!row) return null;
      return { key: row.key, value: row.value, context: row.context, createdAt: row.created_at, updatedAt: row.updated_at };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const { changes } = db.prepare(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(namespaceId, key, scopeId ?? null, scopeId ?? null);
      return changes > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      db.prepare(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(namespaceId, scopeId ?? null, scopeId ?? null);
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db.prepare(
        `SELECT namespace_id, key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id IN (${placeholders}) AND (? IS NULL OR scope_id = ?)`,
      ).all(...ids, scopeId ?? null, scopeId ?? null);
      return rows.map((r: any) => ({
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

function createSkillStore(db: SqliteDatabase, p: string): SkillStore {
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
      const rows = db.prepare(`SELECT name, description, tags, phase FROM ${p}skills ORDER BY name`).all();
      return rows.map((r: any) => ({
        name: r.name,
        description: r.description,
        tags: jsonParse(r.tags, []),
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const row = db.prepare(`SELECT * FROM ${p}skills WHERE name = ?`).get(name);
      return row ? rowToSkill(row) : null;
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO ${p}skills (name, description, tags, phase, content, raw_content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(name, (meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now);
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE ${p}skills SET description = ?, tags = ?, phase = ?, content = ?, raw_content = ?, updated_at = ? WHERE name = ?`,
      ).run((meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now, name);
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const { changes } = db.prepare(`DELETE FROM ${p}skills WHERE name = ?`).run(name);
      return changes > 0;
    },

    async getSkillSummaries() {
      const rows = db.prepare(`SELECT name, description FROM ${p}skills ORDER BY name`).all();
      if (!rows.length) return "";
      return rows.map((r: any) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(db: SqliteDatabase, p: string): TaskStore {
  function rowToTask(r: any): Task {
    return { id: r.id, title: r.title, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO ${p}tasks (id, title, status, created_at, updated_at) VALUES (?, ?, 'todo', ?, ?)`).run(id, title, now, now);
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      return db.prepare(`SELECT * FROM ${p}tasks ORDER BY created_at`).all().map(rowToTask);
    },

    async updateTask(id, updates) {
      const now = new Date().toISOString();
      const row = db.prepare(`SELECT * FROM ${p}tasks WHERE id = ?`).get(id) as any;
      const newTitle = updates.title ?? row.title;
      const newStatus = updates.status ?? row.status;
      db.prepare(`UPDATE ${p}tasks SET title = ?, status = ?, updated_at = ? WHERE id = ?`).run(newTitle, newStatus, now, id);
      return { id, title: newTitle, status: newStatus, createdAt: row.created_at, updatedAt: now };
    },

    async deleteTask(id) {
      const { changes } = db.prepare(`DELETE FROM ${p}tasks WHERE id = ?`).run(id);
      return changes > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(db: SqliteDatabase, p: string): PromptStore {
  return {
    async loadOverrides() {
      const rows = db.prepare(`SELECT name, prompt, updated_at FROM ${p}prompt_overrides`).all();
      const result: Record<string, PromptOverride> = {};
      for (const r of rows as any[]) {
        result[r.name] = { prompt: r.prompt, updatedAt: r.updated_at };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      const existing = db.prepare(`SELECT name FROM ${p}prompt_overrides WHERE name = ?`).get(name);
      if (existing) {
        db.prepare(`UPDATE ${p}prompt_overrides SET prompt = ?, updated_at = ? WHERE name = ?`).run(prompt, now, name);
      } else {
        db.prepare(`INSERT INTO ${p}prompt_overrides (name, prompt, updated_at) VALUES (?, ?, ?)`).run(name, prompt, now);
      }
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { changes } = db.prepare(`DELETE FROM ${p}prompt_overrides WHERE name = ?`).run(name);
      return changes > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(db: SqliteDatabase, p: string): CommandStore {
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
      const rows = db.prepare(`SELECT * FROM ${p}commands WHERE scope_id = ? ORDER BY name`).all(scopeId ?? "");
      return rows.map(rowToCommand);
    },

    async get(name, scopeId?) {
      const row = db.prepare(`SELECT * FROM ${p}commands WHERE name = ? AND scope_id = ?`).get(name, scopeId ?? "");
      return row ? rowToCommand(row) : undefined;
    },

    async save(command, scopeId?) {
      const existing = db.prepare(`SELECT name FROM ${p}commands WHERE name = ? AND scope_id = ?`).get(command.name, scopeId ?? "");
      if (existing) {
        db.prepare(
          `UPDATE ${p}commands SET description = ?, system = ?, tools = ?, model = ?, format = ? WHERE name = ? AND scope_id = ?`,
        ).run(command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null, command.name, scopeId ?? "");
      } else {
        db.prepare(
          `INSERT INTO ${p}commands (name, scope_id, description, system, tools, model, format) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(command.name, scopeId ?? "", command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null);
      }
    },

    async delete(name, scopeId?) {
      db.prepare(`DELETE FROM ${p}commands WHERE name = ? AND scope_id = ?`).run(name, scopeId ?? "");
    },
  };
}

// ── Cron Store ──

function createCronStore(db: SqliteDatabase, p: string): CronStore {
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
      db.prepare(
        `INSERT INTO ${p}cron_jobs (id, name, description, schedule, run_at, agent_name, input, model, timezone, enabled, next_run, last_run, scope_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.name, input.description, input.schedule ?? null, input.runAt ?? null,
        input.agentName, input.input, input.model ?? null, input.timezone ?? "UTC",
        input.enabled ? 1 : 0, input.nextRun ?? null, input.lastRun ?? null, scopeId ?? null, now, now,
      );
      return rowToCronJob(db.prepare(`SELECT * FROM ${p}cron_jobs WHERE id = ?`).get(id));
    },

    async get(id, scopeId?) {
      const row = db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(id, scopeId ?? null, scopeId ?? null);
      return row ? rowToCronJob(row) : null;
    },

    async list(scopeId?) {
      const rows = db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at`,
      ).all(scopeId ?? null, scopeId ?? null);
      return rows.map(rowToCronJob);
    },

    async update(id, updates, scopeId?) {
      const row = db.prepare(
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(id, scopeId ?? null, scopeId ?? null) as any;
      const u: any = { ...row, ...updates };
      const now = updates.updatedAt ?? new Date().toISOString();
      db.prepare(
        `UPDATE ${p}cron_jobs SET name=?, description=?, schedule=?, run_at=?, agent_name=?, input=?, model=?, timezone=?, enabled=?, next_run=?, last_run=?, updated_at=?
         WHERE id = ?`,
      ).run(
        u.name, u.description, u.schedule ?? null, u.runAt ?? u.run_at ?? null,
        u.agentName ?? u.agent_name, u.input, u.model ?? null, u.timezone ?? "UTC",
        (u.enabled ?? true) ? 1 : 0, u.nextRun ?? u.next_run ?? null, u.lastRun ?? u.last_run ?? null, now, id,
      );
      return rowToCronJob(db.prepare(`SELECT * FROM ${p}cron_jobs WHERE id = ?`).get(id));
    },

    async delete(id, scopeId?) {
      const { changes } = db.prepare(
        `DELETE FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(id, scopeId ?? null, scopeId ?? null);
      return changes > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO ${p}cron_executions (id, cron_id, started_at, completed_at, status, summary, error, scope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.cronId, input.startedAt, input.completedAt ?? null, input.status, input.summary ?? null, input.error ?? null, scopeId ?? null);
      return rowToExecution(db.prepare(`SELECT * FROM ${p}cron_executions WHERE id = ?`).get(id));
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const rows = db.prepare(
        `SELECT * FROM ${p}cron_executions WHERE cron_id = ? AND (? IS NULL OR scope_id = ?) ORDER BY started_at DESC LIMIT ?`,
      ).all(cronId, scopeId ?? null, scopeId ?? null, limit);
      return rows.map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const row = db.prepare(
        `SELECT * FROM ${p}cron_executions WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(id, scopeId ?? null, scopeId ?? null) as any;
      const u = { ...row, ...updates };
      db.prepare(
        `UPDATE ${p}cron_executions SET completed_at=?, status=?, summary=?, error=? WHERE id = ?`,
      ).run(u.completedAt ?? u.completed_at ?? null, u.status, u.summary ?? null, u.error ?? null, id);
      return rowToExecution(db.prepare(`SELECT * FROM ${p}cron_executions WHERE id = ?`).get(id));
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const rows = db.prepare(
        `SELECT * FROM ${p}cron_jobs
         WHERE enabled = 1 AND (? IS NULL OR scope_id = ?)
           AND (next_run <= ? OR (run_at <= ? AND last_run IS NULL))
         ORDER BY COALESCE(next_run, run_at)`,
      ).all(scopeId ?? null, scopeId ?? null, iso, iso);
      return rows.map(rowToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(db: SqliteDatabase, p: string): JobStore {
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
      db.prepare(
        `INSERT INTO ${p}jobs (id, agent_name, input, conversation_id, scope_id, status, result, error,
          usage_prompt_tokens, usage_completion_tokens, usage_total_tokens, tools_used, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, job.agentName, job.input, job.conversationId, job.scopeId ?? null,
        job.status, job.result ?? null, job.error ?? null,
        job.usage?.promptTokens ?? null, job.usage?.completionTokens ?? null, job.usage?.totalTokens ?? null,
        job.toolsUsed ? JSON.stringify(job.toolsUsed) : null, now, job.startedAt ?? null, job.completedAt ?? null,
      );
      return rowToJob(db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).get(id));
    },

    async get(id, scopeId?) {
      const row = db.prepare(
        `SELECT * FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).get(id, scopeId ?? null, scopeId ?? null);
      return row ? rowToJob(row) : null;
    },

    async list(scopeId?) {
      const rows = db.prepare(
        `SELECT * FROM ${p}jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at DESC`,
      ).all(scopeId ?? null, scopeId ?? null);
      return rows.map(rowToJob);
    },

    async update(id, updates) {
      const row = db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).get(id) as any;
      const u: any = { ...updates };
      if (u.agentName !== undefined) row.agent_name = u.agentName;
      if (u.input !== undefined) row.input = u.input;
      if (u.conversationId !== undefined) row.conversation_id = u.conversationId;
      if (u.scopeId !== undefined) row.scope_id = u.scopeId;
      if (u.status !== undefined) row.status = u.status;
      if (u.result !== undefined) row.result = u.result;
      if (u.error !== undefined) row.error = u.error;
      if (u.startedAt !== undefined) row.started_at = u.startedAt;
      if (u.completedAt !== undefined) row.completed_at = u.completedAt;
      if (u.usage) {
        row.usage_prompt_tokens = u.usage.promptTokens;
        row.usage_completion_tokens = u.usage.completionTokens;
        row.usage_total_tokens = u.usage.totalTokens;
      }
      if (u.toolsUsed !== undefined) row.tools_used = JSON.stringify(u.toolsUsed);
      db.prepare(
        `UPDATE ${p}jobs SET agent_name=?, input=?, conversation_id=?, scope_id=?, status=?, result=?, error=?,
          usage_prompt_tokens=?, usage_completion_tokens=?, usage_total_tokens=?, tools_used=?, started_at=?, completed_at=?
         WHERE id = ?`,
      ).run(
        row.agent_name, row.input, row.conversation_id, row.scope_id, row.status, row.result, row.error,
        row.usage_prompt_tokens, row.usage_completion_tokens, row.usage_total_tokens, row.tools_used,
        row.started_at, row.completed_at, id,
      );
      return rowToJob(db.prepare(`SELECT * FROM ${p}jobs WHERE id = ?`).get(id));
    },

    async delete(id, scopeId?) {
      const { changes } = db.prepare(
        `DELETE FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
      ).run(id, scopeId ?? null, scopeId ?? null);
      return changes > 0;
    },
  };
}

// ── Factory ──

export async function createSqliteStorage(config: SqliteConfig): Promise<StorageProvider> {
  const { database: db } = config;
  const p = config.tablePrefix ?? "kitn_";

  // Enable WAL mode and foreign keys for better performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  if (config.autoMigrate !== false) {
    runMigrations(db, p);
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
