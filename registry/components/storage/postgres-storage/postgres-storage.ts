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

interface PostgresClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

interface PostgresConfig {
  client: PostgresClient;
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

// ── Migrations ──

async function runMigrations(client: PostgresClient, p: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}conversations (
      id TEXT PRIMARY KEY,
      scope_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}conversation_messages (
      id SERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}memory_entries (
      namespace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      scope_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (namespace_id, key, COALESCE(scope_id, ''))
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      phase TEXT NOT NULL DEFAULT 'both',
      content TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (
      name TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}commands (
      name TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      system TEXT NOT NULL DEFAULT '',
      tools TEXT[] NOT NULL DEFAULT '{}',
      model TEXT,
      format TEXT,
      PRIMARY KEY (name, scope_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      schedule TEXT,
      run_at TIMESTAMPTZ,
      agent_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      model TEXT,
      timezone TEXT DEFAULT 'UTC',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      next_run TIMESTAMPTZ,
      last_run TIMESTAMPTZ,
      scope_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}cron_executions (
      id TEXT PRIMARY KEY,
      cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT,
      scope_id TEXT
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${p}jobs (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL,
      scope_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      error TEXT,
      usage_prompt_tokens INT,
      usage_completion_tokens INT,
      usage_total_tokens INT,
      tools_used TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
}

// ── Conversation Store ──

function createConversationStore(client: PostgresClient, p: string): ConversationStore {
  return {
    async get(id, scopeId?) {
      const { rows } = await client.query(
        `SELECT c.id, c.scope_id, c.created_at, c.updated_at,
                COALESCE(json_agg(json_build_object(
                  'role', m.role, 'content', m.content, 'timestamp', m.timestamp, 'metadata', m.metadata
                ) ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '[]') AS messages
         FROM ${p}conversations c
         LEFT JOIN ${p}conversation_messages m ON m.conversation_id = c.id
         WHERE c.id = $1 AND ($2::text IS NULL OR c.scope_id = $2)
         GROUP BY c.id`,
        [id, scopeId ?? null],
      );
      if (!rows.length) return null;
      const row = rows[0];
      return {
        id: row.id,
        messages: typeof row.messages === "string" ? JSON.parse(row.messages) : row.messages,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    },

    async list(scopeId?) {
      const { rows } = await client.query(
        `SELECT c.id, c.updated_at, COUNT(m.id)::int AS message_count
         FROM ${p}conversations c
         LEFT JOIN ${p}conversation_messages m ON m.conversation_id = c.id
         WHERE ($1::text IS NULL OR c.scope_id = $1)
         GROUP BY c.id
         ORDER BY c.updated_at DESC`,
        [scopeId ?? null],
      );
      return rows.map((r) => ({
        id: r.id,
        messageCount: r.message_count,
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
        [id, scopeId ?? null, now],
      );
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      // Upsert conversation
      await client.query(
        `INSERT INTO ${p}conversations (id, scope_id, created_at, updated_at) VALUES ($1, $2, $3, $3)
         ON CONFLICT (id) DO UPDATE SET updated_at = $3`,
        [id, scopeId ?? null, now],
      );
      // Insert message
      await client.query(
        `INSERT INTO ${p}conversation_messages (conversation_id, role, content, metadata, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [id, message.role, message.content, message.metadata ? JSON.stringify(message.metadata) : null, message.timestamp],
      );
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}conversations WHERE id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [id, scopeId ?? null],
      );
      return (rowCount ?? 0) > 0;
    },

    async clear(id, scopeId?) {
      await client.query(
        `DELETE FROM ${p}conversation_messages WHERE conversation_id = $1`,
        [id],
      );
      const now = new Date().toISOString();
      await client.query(
        `UPDATE ${p}conversations SET updated_at = $2 WHERE id = $1 AND ($3::text IS NULL OR scope_id = $3)`,
        [id, now, scopeId ?? null],
      );
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(client: PostgresClient, p: string): MemoryStore {
  return {
    async listNamespaces(scopeId?) {
      const { rows } = await client.query(
        `SELECT DISTINCT namespace_id FROM ${p}memory_entries WHERE ($1::text IS NULL OR scope_id = $1)`,
        [scopeId ?? null],
      );
      return rows.map((r) => r.namespace_id);
    },

    async listEntries(namespaceId, scopeId?) {
      const { rows } = await client.query(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [namespaceId, scopeId ?? null],
      );
      return rows.map((r) => ({
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO ${p}memory_entries (namespace_id, key, value, context, scope_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (namespace_id, key, COALESCE(scope_id, ''))
         DO UPDATE SET value = $3, context = $4, updated_at = $6
         RETURNING key, value, context, created_at, updated_at`,
        [namespaceId, key, value, context, scopeId ?? null, now],
      );
      const r = rows[0];
      return {
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    },

    async getEntry(namespaceId, key, scopeId?) {
      const { rows } = await client.query(
        `SELECT key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id = $1 AND key = $2 AND ($3::text IS NULL OR scope_id = $3)`,
        [namespaceId, key, scopeId ?? null],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = $1 AND key = $2 AND ($3::text IS NULL OR scope_id = $3)`,
        [namespaceId, key, scopeId ?? null],
      );
      return (rowCount ?? 0) > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      await client.query(
        `DELETE FROM ${p}memory_entries WHERE namespace_id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [namespaceId, scopeId ?? null],
      );
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await client.query(
        `SELECT namespace_id, key, value, context, created_at, updated_at FROM ${p}memory_entries
         WHERE namespace_id IN (${placeholders}) AND ($${ids.length + 1}::text IS NULL OR scope_id = $${ids.length + 1})`,
        [...ids, scopeId ?? null],
      );
      return rows.map((r) => ({
        namespace: r.namespace_id,
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    },
  };
}

// ── Skill Store ──

function createSkillStore(client: PostgresClient, p: string): SkillStore {
  function rowToSkill(r: any): Skill {
    return {
      name: r.name,
      description: r.description,
      tags: r.tags ?? [],
      phase: (r.phase ?? "both") as SkillPhase,
      content: r.content,
      rawContent: r.raw_content,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  return {
    async listSkills() {
      const { rows } = await client.query(
        `SELECT name, description, tags, phase FROM ${p}skills ORDER BY name`,
      );
      return rows.map((r) => ({
        name: r.name,
        description: r.description,
        tags: r.tags ?? [],
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}skills WHERE name = $1`,
        [name],
      );
      return rows.length ? rowToSkill(rows[0]) : null;
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO ${p}skills (name, description, tags, phase, content, raw_content, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          name,
          (meta.description as string) ?? "",
          (meta.tags as string[]) ?? [],
          (meta.phase as string) ?? "both",
          body,
          rawContent,
          now,
        ],
      );
      return rowToSkill(rows[0]);
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `UPDATE ${p}skills SET description = $2, tags = $3, phase = $4, content = $5, raw_content = $6, updated_at = $7
         WHERE name = $1 RETURNING *`,
        [
          name,
          (meta.description as string) ?? "",
          (meta.tags as string[]) ?? [],
          (meta.phase as string) ?? "both",
          body,
          rawContent,
          now,
        ],
      );
      return rowToSkill(rows[0]);
    },

    async deleteSkill(name) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}skills WHERE name = $1`,
        [name],
      );
      return (rowCount ?? 0) > 0;
    },

    async getSkillSummaries() {
      const { rows } = await client.query(
        `SELECT name, description FROM ${p}skills ORDER BY name`,
      );
      if (!rows.length) return "";
      return rows.map((r) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(client: PostgresClient, p: string): TaskStore {
  function rowToTask(r: any): Task {
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO ${p}tasks (id, title, status, created_at, updated_at) VALUES ($1, $2, 'todo', $3, $3) RETURNING *`,
        [id, title, now],
      );
      return rowToTask(rows[0]);
    },

    async listTasks() {
      const { rows } = await client.query(`SELECT * FROM ${p}tasks ORDER BY created_at`);
      return rows.map(rowToTask);
    },

    async updateTask(id, updates) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (updates.title !== undefined) { sets.push(`title = $${idx++}`); params.push(updates.title); }
      if (updates.status !== undefined) { sets.push(`status = $${idx++}`); params.push(updates.status); }
      sets.push(`updated_at = $${idx++}`);
      params.push(new Date().toISOString());
      params.push(id);
      const { rows } = await client.query(
        `UPDATE ${p}tasks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        params,
      );
      return rowToTask(rows[0]);
    },

    async deleteTask(id) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}tasks WHERE id = $1`,
        [id],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(client: PostgresClient, p: string): PromptStore {
  return {
    async loadOverrides() {
      const { rows } = await client.query(`SELECT name, prompt, updated_at FROM ${p}prompt_overrides`);
      const result: Record<string, PromptOverride> = {};
      for (const r of rows) {
        result[r.name] = { prompt: r.prompt, updatedAt: new Date(r.updated_at).toISOString() };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO ${p}prompt_overrides (name, prompt, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET prompt = $2, updated_at = $3`,
        [name, prompt, now],
      );
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}prompt_overrides WHERE name = $1`,
        [name],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(client: PostgresClient, p: string): CommandStore {
  function rowToCommand(r: any): CommandRegistration {
    return {
      name: r.name,
      description: r.description,
      system: r.system,
      tools: r.tools ?? [],
      model: r.model ?? undefined,
      format: r.format ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}commands WHERE scope_id = $1 ORDER BY name`,
        [scopeId ?? ""],
      );
      return rows.map(rowToCommand);
    },

    async get(name, scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}commands WHERE name = $1 AND scope_id = $2`,
        [name, scopeId ?? ""],
      );
      return rows.length ? rowToCommand(rows[0]) : undefined;
    },

    async save(command, scopeId?) {
      await client.query(
        `INSERT INTO ${p}commands (name, scope_id, description, system, tools, model, format)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name, scope_id) DO UPDATE SET description = $3, system = $4, tools = $5, model = $6, format = $7`,
        [command.name, scopeId ?? "", command.description, command.system, command.tools ?? [], command.model ?? null, command.format ?? null],
      );
    },

    async delete(name, scopeId?) {
      await client.query(
        `DELETE FROM ${p}commands WHERE name = $1 AND scope_id = $2`,
        [name, scopeId ?? ""],
      );
    },
  };
}

// ── Cron Store ──

function createCronStore(client: PostgresClient, p: string): CronStore {
  function rowToCronJob(r: any): CronJob {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      schedule: r.schedule ?? undefined,
      runAt: r.run_at ? new Date(r.run_at).toISOString() : undefined,
      agentName: r.agent_name,
      input: r.input,
      model: r.model ?? undefined,
      timezone: r.timezone ?? "UTC",
      enabled: r.enabled,
      nextRun: r.next_run ? new Date(r.next_run).toISOString() : undefined,
      lastRun: r.last_run ? new Date(r.last_run).toISOString() : undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  function rowToExecution(r: any): CronExecution {
    return {
      id: r.id,
      cronId: r.cron_id,
      startedAt: new Date(r.started_at).toISOString(),
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : undefined,
      status: r.status,
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO ${p}cron_jobs (id, name, description, schedule, run_at, agent_name, input, model, timezone, enabled, next_run, last_run, scope_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
         RETURNING *`,
        [
          id, input.name, input.description, input.schedule ?? null, input.runAt ?? null,
          input.agentName, input.input, input.model ?? null, input.timezone ?? "UTC",
          input.enabled, input.nextRun ?? null, input.lastRun ?? null, scopeId ?? null, now,
        ],
      );
      return rowToCronJob(rows[0]);
    },

    async get(id, scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}cron_jobs WHERE id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [id, scopeId ?? null],
      );
      return rows.length ? rowToCronJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}cron_jobs WHERE ($1::text IS NULL OR scope_id = $1) ORDER BY created_at`,
        [scopeId ?? null],
      );
      return rows.map(rowToCronJob);
    },

    async update(id, updates, scopeId?) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      const fields: Record<string, string> = {
        name: "name", description: "description", schedule: "schedule", runAt: "run_at",
        agentName: "agent_name", input: "input", model: "model", timezone: "timezone",
        enabled: "enabled", nextRun: "next_run", lastRun: "last_run", updatedAt: "updated_at",
      };
      for (const [key, col] of Object.entries(fields)) {
        if ((updates as any)[key] !== undefined) {
          sets.push(`${col} = $${idx++}`);
          params.push((updates as any)[key]);
        }
      }
      if (!sets.some((s) => s.startsWith("updated_at"))) {
        sets.push(`updated_at = $${idx++}`);
        params.push(new Date().toISOString());
      }
      params.push(id);
      params.push(scopeId ?? null);
      const { rows } = await client.query(
        `UPDATE ${p}cron_jobs SET ${sets.join(", ")} WHERE id = $${idx} AND ($${idx + 1}::text IS NULL OR scope_id = $${idx + 1}) RETURNING *`,
        params,
      );
      return rowToCronJob(rows[0]);
    },

    async delete(id, scopeId?) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}cron_jobs WHERE id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [id, scopeId ?? null],
      );
      return (rowCount ?? 0) > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      const { rows } = await client.query(
        `INSERT INTO ${p}cron_executions (id, cron_id, started_at, completed_at, status, summary, error, scope_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, input.cronId, input.startedAt, input.completedAt ?? null, input.status, input.summary ?? null, input.error ?? null, scopeId ?? null],
      );
      return rowToExecution(rows[0]);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}cron_executions WHERE cron_id = $1 AND ($2::text IS NULL OR scope_id = $2) ORDER BY started_at DESC LIMIT $3`,
        [cronId, scopeId ?? null, limit],
      );
      return rows.map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (updates.completedAt !== undefined) { sets.push(`completed_at = $${idx++}`); params.push(updates.completedAt); }
      if (updates.status !== undefined) { sets.push(`status = $${idx++}`); params.push(updates.status); }
      if (updates.summary !== undefined) { sets.push(`summary = $${idx++}`); params.push(updates.summary); }
      if (updates.error !== undefined) { sets.push(`error = $${idx++}`); params.push(updates.error); }
      if (!sets.length) {
        const existing = await client.query(`SELECT * FROM ${p}cron_executions WHERE id = $1`, [id]);
        return rowToExecution(existing.rows[0]);
      }
      params.push(id);
      params.push(scopeId ?? null);
      const { rows } = await client.query(
        `UPDATE ${p}cron_executions SET ${sets.join(", ")} WHERE id = $${idx} AND ($${idx + 1}::text IS NULL OR scope_id = $${idx + 1}) RETURNING *`,
        params,
      );
      return rowToExecution(rows[0]);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const { rows } = await client.query(
        `SELECT * FROM ${p}cron_jobs
         WHERE enabled = true AND ($2::text IS NULL OR scope_id = $2)
           AND (next_run <= $1 OR (run_at <= $1 AND last_run IS NULL))
         ORDER BY COALESCE(next_run, run_at)`,
        [iso, scopeId ?? null],
      );
      return rows.map(rowToCronJob);
    },
  };
}

// ── Job Store ──

function createJobStore(client: PostgresClient, p: string): JobStore {
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
      toolsUsed: r.tools_used ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : undefined,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO ${p}jobs (id, agent_name, input, conversation_id, scope_id, status, result, error,
          usage_prompt_tokens, usage_completion_tokens, usage_total_tokens, tools_used, created_at, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          id, job.agentName, job.input, job.conversationId, job.scopeId ?? null,
          job.status, job.result ?? null, job.error ?? null,
          job.usage?.promptTokens ?? null, job.usage?.completionTokens ?? null, job.usage?.totalTokens ?? null,
          job.toolsUsed ?? null, now, job.startedAt ?? null, job.completedAt ?? null,
        ],
      );
      return rowToJob(rows[0]);
    },

    async get(id, scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}jobs WHERE id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [id, scopeId ?? null],
      );
      return rows.length ? rowToJob(rows[0]) : null;
    },

    async list(scopeId?) {
      const { rows } = await client.query(
        `SELECT * FROM ${p}jobs WHERE ($1::text IS NULL OR scope_id = $1) ORDER BY created_at DESC`,
        [scopeId ?? null],
      );
      return rows.map(rowToJob);
    },

    async update(id, updates) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      const simpleFields: Record<string, string> = {
        agentName: "agent_name", input: "input", conversationId: "conversation_id",
        scopeId: "scope_id", status: "status", result: "result", error: "error",
        startedAt: "started_at", completedAt: "completed_at",
      };
      for (const [key, col] of Object.entries(simpleFields)) {
        if ((updates as any)[key] !== undefined) {
          sets.push(`${col} = $${idx++}`);
          params.push((updates as any)[key]);
        }
      }
      if (updates.usage) {
        sets.push(`usage_prompt_tokens = $${idx++}`); params.push(updates.usage.promptTokens);
        sets.push(`usage_completion_tokens = $${idx++}`); params.push(updates.usage.completionTokens);
        sets.push(`usage_total_tokens = $${idx++}`); params.push(updates.usage.totalTokens);
      }
      if (updates.toolsUsed !== undefined) {
        sets.push(`tools_used = $${idx++}`);
        params.push(updates.toolsUsed);
      }
      if (!sets.length) {
        const existing = await client.query(`SELECT * FROM ${p}jobs WHERE id = $1`, [id]);
        return rowToJob(existing.rows[0]);
      }
      params.push(id);
      const { rows } = await client.query(
        `UPDATE ${p}jobs SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        params,
      );
      return rowToJob(rows[0]);
    },

    async delete(id, scopeId?) {
      const { rowCount } = await client.query(
        `DELETE FROM ${p}jobs WHERE id = $1 AND ($2::text IS NULL OR scope_id = $2)`,
        [id, scopeId ?? null],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

// ── Factory ──

export async function createPostgresStorage(config: PostgresConfig): Promise<StorageProvider> {
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
