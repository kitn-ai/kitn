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

interface LibsqlClient {
  execute(stmt: { sql: string; args?: unknown[] }): Promise<{ rows: any[]; rowsAffected: number }>;
  batch(stmts: Array<{ sql: string; args?: unknown[] }>): Promise<Array<{ rows: any[]; rowsAffected: number }>>;
}

interface LibsqlConfig {
  client: LibsqlClient;
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

async function exec(client: LibsqlClient, sql: string, args?: unknown[]): Promise<{ rows: any[]; rowsAffected: number }> {
  return client.execute({ sql, args });
}

// ── Migrations ──

async function runMigrations(client: LibsqlClient, p: string): Promise<void> {
  await client.batch([
    { sql: `CREATE TABLE IF NOT EXISTS ${p}conversations (id TEXT PRIMARY KEY, scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT, timestamp TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}memory_entries (namespace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace_id, key, COALESCE(scope_id, '')))` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}skills (name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', phase TEXT NOT NULL DEFAULT 'both', content TEXT NOT NULL DEFAULT '', raw_content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (name TEXT PRIMARY KEY, prompt TEXT NOT NULL, updated_at TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}commands (name TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', system TEXT NOT NULL DEFAULT '', tools TEXT NOT NULL DEFAULT '[]', model TEXT, format TEXT, PRIMARY KEY (name, scope_id))` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}cron_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', schedule TEXT, run_at TEXT, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', model TEXT, timezone TEXT DEFAULT 'UTC', enabled INTEGER NOT NULL DEFAULT 1, next_run TEXT, last_run TEXT, scope_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}cron_executions (id TEXT PRIMARY KEY, cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, summary TEXT, error TEXT, scope_id TEXT)` },
    { sql: `CREATE TABLE IF NOT EXISTS ${p}jobs (id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL, scope_id TEXT, status TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, usage_prompt_tokens INTEGER, usage_completion_tokens INTEGER, usage_total_tokens INTEGER, tools_used TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)` },
  ]);
}

// ── Conversation Store ──

function createConversationStore(client: LibsqlClient, p: string): ConversationStore {
  return {
    async get(id, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      if (!rows.length) return null;
      const row = rows[0];
      const { rows: messages } = await exec(client,
        `SELECT role, content, metadata, timestamp FROM ${p}conversation_messages WHERE conversation_id = ? ORDER BY id`,
        [id],
      );
      return {
        id: row.id as string,
        messages: messages.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
          timestamp: m.timestamp as string,
          metadata: jsonParse(m.metadata as string, undefined),
        })),
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };
    },

    async list(scopeId?) {
      const { rows } = await exec(client,
        `SELECT c.id, c.updated_at, COUNT(m.id) AS message_count
         FROM ${p}conversations c
         LEFT JOIN ${p}conversation_messages m ON m.conversation_id = c.id
         WHERE (? IS NULL OR c.scope_id = ?)
         GROUP BY c.id
         ORDER BY c.updated_at DESC`,
        [scopeId ?? null, scopeId ?? null],
      );
      return rows.map((r: any) => ({
        id: r.id as string,
        messageCount: Number(r.message_count),
        updatedAt: r.updated_at as string,
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      await exec(client,
        `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        [id, scopeId ?? null, now, now],
      );
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      const { rows } = await exec(client, `SELECT id FROM ${p}conversations WHERE id = ?`, [id]);
      if (!rows.length) {
        await exec(client,
          `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          [id, scopeId ?? null, now, now],
        );
      } else {
        await exec(client, `UPDATE ${p}conversations SET updated_at = ? WHERE id = ?`, [now, id]);
      }
      await exec(client,
        `INSERT INTO ${p}conversation_messages (conversation_id, role, content, metadata, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [id, message.role, message.content, message.metadata ? JSON.stringify(message.metadata) : null, message.timestamp],
      );
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const { rowsAffected } = await exec(client,
        `DELETE FROM ${p}conversations WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      return rowsAffected > 0;
    },

    async clear(id, scopeId?) {
      const now = new Date().toISOString();
      await exec(client, `DELETE FROM ${p}conversation_messages WHERE conversation_id = ?`, [id]);
      await exec(client,
        `UPDATE ${p}conversations SET updated_at = ? WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [now, id, scopeId ?? null, scopeId ?? null],
      );
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(client: LibsqlClient, p: string): MemoryStore {
  return {
    async listNamespaces(scopeId?) {
      const { rows } = await exec(client,
        `SELECT DISTINCT namespace_id FROM ${p}memory_entries WHERE (? IS NULL OR scope_id = ?)`,
        [scopeId ?? null, scopeId ?? null],
      );
      return rows.map((r: any) => r.namespace_id as string);
    },

    async listEntries(namespaceId, scopeId?) {
      const { rows } = await exec(client,
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
        [namespaceId, scopeId ?? null, scopeId ?? null],
      );
      return rows.map((r: any) => ({
        key: r.key as string,
        value: r.value as string,
        context: r.context as string,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      const { rows } = await exec(client,
        `SELECT created_at FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
        [namespaceId, key, scopeId ?? ""],
      );
      if (rows.length) {
        await exec(client,
          `UPDATE ${p}memory_entries SET value = ?, context = ?, updated_at = ?
           WHERE namespace_id = ? AND key = ? AND COALESCE(scope_id, '') = ?`,
          [value, context, now, namespaceId, key, scopeId ?? ""],
        );
        return { key, value, context, createdAt: rows[0].created_at as string, updatedAt: now };
      } else {
        await exec(client,
          `INSERT INTO ${p}memory_entries (namespace_id, key, value, context, scope_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [namespaceId, key, value, context, scopeId ?? null, now, now],
        );
        return { key, value, context, createdAt: now, updatedAt: now };
      }
    },

    async getEntry(namespaceId, key, scopeId?) {
      const { rows } = await exec(client,
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
        [namespaceId, key, scopeId ?? null, scopeId ?? null],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { key: r.key as string, value: r.value as string, context: r.context as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const { rowsAffected } = await exec(client,
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND key = ? AND (? IS NULL OR scope_id = ?)`,
        [namespaceId, key, scopeId ?? null, scopeId ?? null],
      );
      return rowsAffected > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      await exec(client,
        `DELETE FROM ${p}memory_entries WHERE namespace_id = ? AND (? IS NULL OR scope_id = ?)`,
        [namespaceId, scopeId ?? null, scopeId ?? null],
      );
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const { rows } = await exec(client,
        `SELECT namespace_id, key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id IN (${placeholders}) AND (? IS NULL OR scope_id = ?)`,
        [...ids, scopeId ?? null, scopeId ?? null],
      );
      return rows.map((r: any) => ({
        namespace: r.namespace_id as string,
        key: r.key as string,
        value: r.value as string,
        context: r.context as string,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      }));
    },
  };
}

// ── Skill Store ──

function createSkillStore(client: LibsqlClient, p: string): SkillStore {
  function rowToSkill(r: any): Skill {
    return {
      name: r.name as string,
      description: r.description as string,
      tags: jsonParse(r.tags as string, []),
      phase: (r.phase ?? "both") as SkillPhase,
      content: r.content as string,
      rawContent: r.raw_content as string,
      updatedAt: r.updated_at as string,
    };
  }

  return {
    async listSkills() {
      const { rows } = await exec(client, `SELECT name, description, tags, phase FROM ${p}skills ORDER BY name`);
      return rows.map((r: any) => ({
        name: r.name as string,
        description: r.description as string,
        tags: jsonParse(r.tags as string, []),
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const { rows } = await exec(client, `SELECT * FROM ${p}skills WHERE name = ?`, [name]);
      return rows.length ? rowToSkill(rows[0]) : null;
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await exec(client,
        `INSERT INTO ${p}skills (name, description, tags, phase, content, raw_content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, (meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now],
      );
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await exec(client,
        `UPDATE ${p}skills SET description = ?, tags = ?, phase = ?, content = ?, raw_content = ?, updated_at = ? WHERE name = ?`,
        [(meta.description as string) ?? "", JSON.stringify((meta.tags as string[]) ?? []), (meta.phase as string) ?? "both", body, rawContent, now, name],
      );
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const { rowsAffected } = await exec(client, `DELETE FROM ${p}skills WHERE name = ?`, [name]);
      return rowsAffected > 0;
    },

    async getSkillSummaries() {
      const { rows } = await exec(client, `SELECT name, description FROM ${p}skills ORDER BY name`);
      if (!rows.length) return "";
      return rows.map((r: any) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(client: LibsqlClient, p: string): TaskStore {
  function rowToTask(r: any): Task {
    return { id: r.id as string, title: r.title as string, status: r.status as Task["status"], createdAt: r.created_at as string, updatedAt: r.updated_at as string };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await exec(client, `INSERT INTO ${p}tasks (id, title, status, created_at, updated_at) VALUES (?, ?, 'todo', ?, ?)`, [id, title, now, now]);
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      const { rows } = await exec(client, `SELECT * FROM ${p}tasks ORDER BY created_at`);
      return rows.map(rowToTask);
    },

    async updateTask(id, updates) {
      const { rows } = await exec(client, `SELECT * FROM ${p}tasks WHERE id = ?`, [id]);
      const row = rows[0] as any;
      const now = new Date().toISOString();
      const newTitle = updates.title ?? row.title;
      const newStatus = updates.status ?? row.status;
      await exec(client, `UPDATE ${p}tasks SET title = ?, status = ?, updated_at = ? WHERE id = ?`, [newTitle, newStatus, now, id]);
      return { id, title: newTitle as string, status: newStatus as Task["status"], createdAt: row.created_at as string, updatedAt: now };
    },

    async deleteTask(id) {
      const { rowsAffected } = await exec(client, `DELETE FROM ${p}tasks WHERE id = ?`, [id]);
      return rowsAffected > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(client: LibsqlClient, p: string): PromptStore {
  return {
    async loadOverrides() {
      const { rows } = await exec(client, `SELECT name, prompt, updated_at FROM ${p}prompt_overrides`);
      const result: Record<string, PromptOverride> = {};
      for (const r of rows) {
        result[r.name as string] = { prompt: r.prompt as string, updatedAt: r.updated_at as string };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      const { rows } = await exec(client, `SELECT name FROM ${p}prompt_overrides WHERE name = ?`, [name]);
      if (rows.length) {
        await exec(client, `UPDATE ${p}prompt_overrides SET prompt = ?, updated_at = ? WHERE name = ?`, [prompt, now, name]);
      } else {
        await exec(client, `INSERT INTO ${p}prompt_overrides (name, prompt, updated_at) VALUES (?, ?, ?)`, [name, prompt, now]);
      }
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { rowsAffected } = await exec(client, `DELETE FROM ${p}prompt_overrides WHERE name = ?`, [name]);
      return rowsAffected > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(client: LibsqlClient, p: string): CommandStore {
  function rowToCommand(r: any): CommandRegistration {
    return {
      name: r.name as string,
      description: r.description as string,
      system: r.system as string,
      tools: jsonParse(r.tools as string, []),
      model: (r.model as string) ?? undefined,
      format: (r.format as string) ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const { rows } = await exec(client, `SELECT * FROM ${p}commands WHERE scope_id = ? ORDER BY name`, [scopeId ?? ""]);
      return rows.map(rowToCommand);
    },

    async get(name, scopeId?) {
      const { rows } = await exec(client, `SELECT * FROM ${p}commands WHERE name = ? AND scope_id = ?`, [name, scopeId ?? ""]);
      return rows.length ? rowToCommand(rows[0]) : undefined;
    },

    async save(command, scopeId?) {
      const { rows } = await exec(client, `SELECT name FROM ${p}commands WHERE name = ? AND scope_id = ?`, [command.name, scopeId ?? ""]);
      if (rows.length) {
        await exec(client,
          `UPDATE ${p}commands SET description = ?, system = ?, tools = ?, model = ?, format = ? WHERE name = ? AND scope_id = ?`,
          [command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null, command.name, scopeId ?? ""],
        );
      } else {
        await exec(client,
          `INSERT INTO ${p}commands (name, scope_id, description, system, tools, model, format) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [command.name, scopeId ?? "", command.description, command.system, JSON.stringify(command.tools ?? []), command.model ?? null, command.format ?? null],
        );
      }
    },

    async delete(name, scopeId?) {
      await exec(client, `DELETE FROM ${p}commands WHERE name = ? AND scope_id = ?`, [name, scopeId ?? ""]);
    },
  };
}

// ── Cron Store ──

function createCronStore(client: LibsqlClient, p: string): CronStore {
  function rowToCronJob(r: any): CronJob {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      schedule: (r.schedule as string) ?? undefined,
      runAt: (r.run_at as string) ?? undefined,
      agentName: r.agent_name as string,
      input: r.input as string,
      model: (r.model as string) ?? undefined,
      timezone: (r.timezone as string) ?? "UTC",
      enabled: Boolean(r.enabled),
      nextRun: (r.next_run as string) ?? undefined,
      lastRun: (r.last_run as string) ?? undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  function rowToExecution(r: any): CronExecution {
    return {
      id: r.id as string,
      cronId: r.cron_id as string,
      startedAt: r.started_at as string,
      completedAt: (r.completed_at as string) ?? undefined,
      status: r.status as CronExecution["status"],
      summary: (r.summary as string) ?? undefined,
      error: (r.error as string) ?? undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await exec(client,
        `INSERT INTO ${p}cron_jobs (id, name, description, schedule, run_at, agent_name, input, model, timezone, enabled, next_run, last_run, scope_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.name, input.description, input.schedule ?? null, input.runAt ?? null, input.agentName, input.input, input.model ?? null, input.timezone ?? "UTC", input.enabled ? 1 : 0, input.nextRun ?? null, input.lastRun ?? null, scopeId ?? null, now, now],
      );
      const { rows } = await exec(client, `SELECT * FROM ${p}cron_jobs WHERE id = ?`, [id]);
      return rowToCronJob(rows[0]);
    },

    async get(id, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      return rows.length ? rowToCronJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at`,
        [scopeId ?? null, scopeId ?? null],
      );
      return rows.map(rowToCronJob);
    },

    async update(id, updates, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      const row = rows[0] as any;
      const u: any = { ...updates };
      const now = u.updatedAt ?? new Date().toISOString();
      await exec(client,
        `UPDATE ${p}cron_jobs SET name=?, description=?, schedule=?, run_at=?, agent_name=?, input=?, model=?, timezone=?, enabled=?, next_run=?, last_run=?, updated_at=? WHERE id=?`,
        [
          u.name ?? row.name, u.description ?? row.description, u.schedule ?? row.schedule ?? null,
          u.runAt ?? row.run_at ?? null, u.agentName ?? row.agent_name, u.input ?? row.input,
          u.model ?? row.model ?? null, u.timezone ?? row.timezone ?? "UTC",
          (u.enabled !== undefined ? u.enabled : Boolean(row.enabled)) ? 1 : 0,
          u.nextRun ?? row.next_run ?? null, u.lastRun ?? row.last_run ?? null, now, id,
        ],
      );
      const { rows: updated } = await exec(client, `SELECT * FROM ${p}cron_jobs WHERE id = ?`, [id]);
      return rowToCronJob(updated[0]);
    },

    async delete(id, scopeId?) {
      const { rowsAffected } = await exec(client,
        `DELETE FROM ${p}cron_jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      return rowsAffected > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      await exec(client,
        `INSERT INTO ${p}cron_executions (id, cron_id, started_at, completed_at, status, summary, error, scope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.cronId, input.startedAt, input.completedAt ?? null, input.status, input.summary ?? null, input.error ?? null, scopeId ?? null],
      );
      const { rows } = await exec(client, `SELECT * FROM ${p}cron_executions WHERE id = ?`, [id]);
      return rowToExecution(rows[0]);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_executions WHERE cron_id = ? AND (? IS NULL OR scope_id = ?) ORDER BY started_at DESC LIMIT ?`,
        [cronId, scopeId ?? null, scopeId ?? null, limit],
      );
      return rows.map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_executions WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      const row = rows[0] as any;
      const u: any = { ...updates };
      await exec(client,
        `UPDATE ${p}cron_executions SET completed_at=?, status=?, summary=?, error=? WHERE id=?`,
        [u.completedAt ?? row.completed_at ?? null, u.status ?? row.status, u.summary ?? row.summary ?? null, u.error ?? row.error ?? null, id],
      );
      const { rows: updated } = await exec(client, `SELECT * FROM ${p}cron_executions WHERE id = ?`, [id]);
      return rowToExecution(updated[0]);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const { rows } = await exec(client,
        `SELECT * FROM ${p}cron_jobs
         WHERE enabled = 1 AND (? IS NULL OR scope_id = ?)
           AND (next_run <= ? OR (run_at <= ? AND last_run IS NULL))
         ORDER BY COALESCE(next_run, run_at)`,
        [scopeId ?? null, scopeId ?? null, iso, iso],
      );
      return rows.map(rowToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(client: LibsqlClient, p: string): JobStore {
  function rowToJob(r: any): Job {
    return {
      id: r.id as string,
      agentName: r.agent_name as string,
      input: r.input as string,
      conversationId: r.conversation_id as string,
      scopeId: (r.scope_id as string) ?? undefined,
      status: r.status as Job["status"],
      result: (r.result as string) ?? undefined,
      error: (r.error as string) ?? undefined,
      usage: r.usage_prompt_tokens != null
        ? { promptTokens: Number(r.usage_prompt_tokens), completionTokens: Number(r.usage_completion_tokens), totalTokens: Number(r.usage_total_tokens) }
        : undefined,
      toolsUsed: jsonParse(r.tools_used as string, undefined),
      createdAt: r.created_at as string,
      startedAt: (r.started_at as string) ?? undefined,
      completedAt: (r.completed_at as string) ?? undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await exec(client,
        `INSERT INTO ${p}jobs (id, agent_name, input, conversation_id, scope_id, status, result, error,
          usage_prompt_tokens, usage_completion_tokens, usage_total_tokens, tools_used, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, job.agentName, job.input, job.conversationId, job.scopeId ?? null, job.status, job.result ?? null, job.error ?? null, job.usage?.promptTokens ?? null, job.usage?.completionTokens ?? null, job.usage?.totalTokens ?? null, job.toolsUsed ? JSON.stringify(job.toolsUsed) : null, now, job.startedAt ?? null, job.completedAt ?? null],
      );
      const { rows } = await exec(client, `SELECT * FROM ${p}jobs WHERE id = ?`, [id]);
      return rowToJob(rows[0]);
    },

    async get(id, scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      return rows.length ? rowToJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const { rows } = await exec(client,
        `SELECT * FROM ${p}jobs WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at DESC`,
        [scopeId ?? null, scopeId ?? null],
      );
      return rows.map(rowToJob);
    },

    async update(id, updates) {
      const { rows } = await exec(client, `SELECT * FROM ${p}jobs WHERE id = ?`, [id]);
      const row = rows[0] as any;
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
      await exec(client,
        `UPDATE ${p}jobs SET agent_name=?, input=?, conversation_id=?, scope_id=?, status=?, result=?, error=?,
          usage_prompt_tokens=?, usage_completion_tokens=?, usage_total_tokens=?, tools_used=?, started_at=?, completed_at=? WHERE id=?`,
        [agentName, input, conversationId, scopeId, status, result, error, promptTokens, completionTokens, totalTokens, toolsUsed, startedAt, completedAt, id],
      );
      const { rows: updated } = await exec(client, `SELECT * FROM ${p}jobs WHERE id = ?`, [id]);
      return rowToJob(updated[0]);
    },

    async delete(id, scopeId?) {
      const { rowsAffected } = await exec(client,
        `DELETE FROM ${p}jobs WHERE id = ? AND (? IS NULL OR scope_id = ?)`,
        [id, scopeId ?? null, scopeId ?? null],
      );
      return rowsAffected > 0;
    },
  };
}

// ── Factory ──

export async function createLibsqlStorage(config: LibsqlConfig): Promise<StorageProvider> {
  const { client } = config;
  const p = config.tablePrefix ?? "kitn_";

  if (config.autoMigrate !== false) {
    await runMigrations(client, p);
  }

  return {
    conversations: createConversationStore(client, p),
    memory: createMemoryStore(client, p),
    skills: createSkillStore(client, p),
    tasks: createTaskStore(client, p),
    prompts: createPromptStore(client, p),
    commands: createCommandStore(client, p),
    crons: createCronStore(client, p),
    jobs: createJobStore(client, p),
  };
}
