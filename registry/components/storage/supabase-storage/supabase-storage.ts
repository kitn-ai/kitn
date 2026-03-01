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

interface SupabaseClient {
  from(table: string): any;
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

interface SupabaseConfig {
  client: SupabaseClient;
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

function unwrap<T>(result: { data: T; error: any }): T {
  if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error));
  return result.data;
}

// ── Auto-migrate (requires service role key with exec_sql RPC or direct SQL access) ──

async function runMigrations(client: SupabaseClient, p: string): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${p}conversations (id TEXT PRIMARY KEY, scope_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}conversation_messages (id SERIAL PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ${p}conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, metadata JSONB, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}memory_entries (namespace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', scope_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (namespace_id, key, COALESCE(scope_id, '')))`,
    `CREATE TABLE IF NOT EXISTS ${p}skills (name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', tags TEXT[] NOT NULL DEFAULT '{}', phase TEXT NOT NULL DEFAULT 'both', content TEXT NOT NULL DEFAULT '', raw_content TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}prompt_overrides (name TEXT PRIMARY KEY, prompt TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}commands (name TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', system TEXT NOT NULL DEFAULT '', tools TEXT[] NOT NULL DEFAULT '{}', model TEXT, format TEXT, PRIMARY KEY (name, scope_id))`,
    `CREATE TABLE IF NOT EXISTS ${p}cron_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', schedule TEXT, run_at TIMESTAMPTZ, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', model TEXT, timezone TEXT DEFAULT 'UTC', enabled BOOLEAN NOT NULL DEFAULT TRUE, next_run TIMESTAMPTZ, last_run TIMESTAMPTZ, scope_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ${p}cron_executions (id TEXT PRIMARY KEY, cron_id TEXT NOT NULL REFERENCES ${p}cron_jobs(id) ON DELETE CASCADE, started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, status TEXT NOT NULL, summary TEXT, error TEXT, scope_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS ${p}jobs (id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL, scope_id TEXT, status TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, usage_prompt_tokens INT, usage_completion_tokens INT, usage_total_tokens INT, tools_used TEXT[], created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ)`,
  ];

  for (const sql of statements) {
    await client.rpc("exec_sql", { query: sql });
  }
}

// ── Conversation Store ──

function createConversationStore(client: SupabaseClient, p: string): ConversationStore {
  const t = `${p}conversations`;
  const tm = `${p}conversation_messages`;

  return {
    async get(id, scopeId?) {
      let query = client.from(t).select("*").eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data, error } = await query.single();
      if (error || !data) return null;

      const { data: messages } = await client.from(tm)
        .select("role, content, metadata, timestamp")
        .eq("conversation_id", id)
        .order("id", { ascending: true });

      return {
        id: data.id,
        messages: (messages ?? []).map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          metadata: m.metadata ?? undefined,
        })),
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async list(scopeId?) {
      let query = client.from(t).select("id, updated_at");
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data: convs } = await query.order("updated_at", { ascending: false });
      if (!convs) return [];

      const summaries: ConversationSummary[] = [];
      for (const c of convs) {
        const { count } = await client.from(tm)
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id);
        summaries.push({ id: c.id, messageCount: count ?? 0, updatedAt: c.updated_at });
      }
      return summaries;
    },

    async create(id, scopeId?) {
      const now = new Date().toISOString();
      unwrap(await client.from(t).insert({ id, scope_id: scopeId ?? null, created_at: now, updated_at: now }));
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = new Date().toISOString();
      // Check if conversation exists
      const { data: existing } = await client.from(t).select("id").eq("id", id).single();
      if (!existing) {
        await client.from(t).insert({ id, scope_id: scopeId ?? null, created_at: now, updated_at: now });
      } else {
        await client.from(t).update({ updated_at: now }).eq("id", id);
      }
      await client.from(tm).insert({
        conversation_id: id,
        role: message.role,
        content: message.content,
        metadata: message.metadata ?? null,
        timestamp: message.timestamp,
      });
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      let query = client.from(t).delete().eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select("id");
      return (data?.length ?? 0) > 0;
    },

    async clear(id, scopeId?) {
      const now = new Date().toISOString();
      await client.from(tm).delete().eq("conversation_id", id);
      let query = client.from(t).update({ updated_at: now }).eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      await query;
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(client: SupabaseClient, p: string): MemoryStore {
  const t = `${p}memory_entries`;

  return {
    async listNamespaces(scopeId?) {
      let query = client.from(t).select("namespace_id");
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query;
      const unique = [...new Set((data ?? []).map((r: any) => r.namespace_id))];
      return unique;
    },

    async listEntries(namespaceId, scopeId?) {
      let query = client.from(t).select("key, value, context, created_at, updated_at").eq("namespace_id", namespaceId);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query;
      return (data ?? []).map((r: any) => ({
        key: r.key,
        value: r.value,
        context: r.context,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = new Date().toISOString();
      // Check existing
      let query = client.from(t).select("created_at").eq("namespace_id", namespaceId).eq("key", key);
      if (scopeId) { query = query.eq("scope_id", scopeId); } else { query = query.is("scope_id", null); }
      const { data: existing } = await query.single();

      if (existing) {
        let updateQuery = client.from(t).update({ value, context, updated_at: now }).eq("namespace_id", namespaceId).eq("key", key);
        if (scopeId) { updateQuery = updateQuery.eq("scope_id", scopeId); } else { updateQuery = updateQuery.is("scope_id", null); }
        await updateQuery;
        return { key, value, context, createdAt: existing.created_at, updatedAt: now };
      }
      await client.from(t).insert({ namespace_id: namespaceId, key, value, context, scope_id: scopeId ?? null, created_at: now, updated_at: now });
      return { key, value, context, createdAt: now, updatedAt: now };
    },

    async getEntry(namespaceId, key, scopeId?) {
      let query = client.from(t).select("key, value, context, created_at, updated_at").eq("namespace_id", namespaceId).eq("key", key);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data, error } = await query.single();
      if (error || !data) return null;
      return { key: data.key, value: data.value, context: data.context, createdAt: data.created_at, updatedAt: data.updated_at };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      let query = client.from(t).delete().eq("namespace_id", namespaceId).eq("key", key);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select("key");
      return (data?.length ?? 0) > 0;
    },

    async clearNamespace(namespaceId, scopeId?) {
      let query = client.from(t).delete().eq("namespace_id", namespaceId);
      if (scopeId) query = query.eq("scope_id", scopeId);
      await query;
    },

    async loadMemoriesForIds(ids, scopeId?) {
      if (!ids.length) return [];
      let query = client.from(t).select("namespace_id, key, value, context, created_at, updated_at").in("namespace_id", ids);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query;
      return (data ?? []).map((r: any) => ({
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

function createSkillStore(client: SupabaseClient, p: string): SkillStore {
  const t = `${p}skills`;

  function rowToSkill(r: any): Skill {
    return {
      name: r.name,
      description: r.description ?? "",
      tags: r.tags ?? [],
      phase: (r.phase ?? "both") as SkillPhase,
      content: r.content ?? "",
      rawContent: r.raw_content ?? "",
      updatedAt: r.updated_at,
    };
  }

  return {
    async listSkills() {
      const { data } = await client.from(t).select("name, description, tags, phase").order("name");
      return (data ?? []).map((r: any) => ({
        name: r.name,
        description: r.description ?? "",
        tags: r.tags ?? [],
        phase: (r.phase ?? "both") as SkillPhase,
      }));
    },

    async getSkill(name) {
      const { data, error } = await client.from(t).select("*").eq("name", name).single();
      if (error || !data) return null;
      return rowToSkill(data);
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await client.from(t).insert({
        name,
        description: (meta.description as string) ?? "",
        tags: (meta.tags as string[]) ?? [],
        phase: (meta.phase as string) ?? "both",
        content: body,
        raw_content: rawContent,
        updated_at: now,
      });
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = new Date().toISOString();
      await client.from(t).update({
        description: (meta.description as string) ?? "",
        tags: (meta.tags as string[]) ?? [],
        phase: (meta.phase as string) ?? "both",
        content: body,
        raw_content: rawContent,
        updated_at: now,
      }).eq("name", name);
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const { data } = await client.from(t).delete().eq("name", name).select("name");
      return (data?.length ?? 0) > 0;
    },

    async getSkillSummaries() {
      const { data } = await client.from(t).select("name, description").order("name");
      if (!data?.length) return "";
      return data.map((r: any) => `- ${r.name}: ${r.description}`).join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(client: SupabaseClient, p: string): TaskStore {
  const t = `${p}tasks`;

  function rowToTask(r: any): Task {
    return { id: r.id, title: r.title, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { data } = await client.from(t).insert({ id, title, status: "todo", created_at: now, updated_at: now }).select().single();
      return rowToTask(data);
    },

    async listTasks() {
      const { data } = await client.from(t).select("*").order("created_at");
      return (data ?? []).map(rowToTask);
    },

    async updateTask(id, updates) {
      const now = new Date().toISOString();
      const setValues: any = { updated_at: now };
      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.status !== undefined) setValues.status = updates.status;
      const { data } = await client.from(t).update(setValues).eq("id", id).select().single();
      return rowToTask(data);
    },

    async deleteTask(id) {
      const { data } = await client.from(t).delete().eq("id", id).select("id");
      return (data?.length ?? 0) > 0;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(client: SupabaseClient, p: string): PromptStore {
  const t = `${p}prompt_overrides`;

  return {
    async loadOverrides() {
      const { data } = await client.from(t).select("name, prompt, updated_at");
      const result: Record<string, PromptOverride> = {};
      for (const r of data ?? []) {
        result[r.name] = { prompt: r.prompt, updatedAt: r.updated_at };
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = new Date().toISOString();
      const { data: existing } = await client.from(t).select("name").eq("name", name).single();
      if (existing) {
        await client.from(t).update({ prompt, updated_at: now }).eq("name", name);
      } else {
        await client.from(t).insert({ name, prompt, updated_at: now });
      }
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const { data } = await client.from(t).delete().eq("name", name).select("name");
      return (data?.length ?? 0) > 0;
    },
  };
}

// ── Command Store ──

function createCommandStore(client: SupabaseClient, p: string): CommandStore {
  const t = `${p}commands`;

  function rowToCommand(r: any): CommandRegistration {
    return {
      name: r.name,
      description: r.description ?? "",
      system: r.system ?? "",
      tools: r.tools ?? [],
      model: r.model ?? undefined,
      format: r.format ?? undefined,
    };
  }

  return {
    async list(scopeId?) {
      const { data } = await client.from(t).select("*").eq("scope_id", scopeId ?? "").order("name");
      return (data ?? []).map(rowToCommand);
    },

    async get(name, scopeId?) {
      const { data, error } = await client.from(t).select("*").eq("name", name).eq("scope_id", scopeId ?? "").single();
      if (error || !data) return undefined;
      return rowToCommand(data);
    },

    async save(command, scopeId?) {
      const { data: existing } = await client.from(t).select("name").eq("name", command.name).eq("scope_id", scopeId ?? "").single();
      if (existing) {
        await client.from(t).update({
          description: command.description,
          system: command.system,
          tools: command.tools ?? [],
          model: command.model ?? null,
          format: command.format ?? null,
        }).eq("name", command.name).eq("scope_id", scopeId ?? "");
      } else {
        await client.from(t).insert({
          name: command.name,
          scope_id: scopeId ?? "",
          description: command.description,
          system: command.system,
          tools: command.tools ?? [],
          model: command.model ?? null,
          format: command.format ?? null,
        });
      }
    },

    async delete(name, scopeId?) {
      await client.from(t).delete().eq("name", name).eq("scope_id", scopeId ?? "");
    },
  };
}

// ── Cron Store ──

function createCronStore(client: SupabaseClient, p: string): CronStore {
  const t = `${p}cron_jobs`;
  const te = `${p}cron_executions`;

  function rowToCronJob(r: any): CronJob {
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      schedule: r.schedule ?? undefined,
      runAt: r.run_at ?? undefined,
      agentName: r.agent_name,
      input: r.input ?? "",
      model: r.model ?? undefined,
      timezone: r.timezone ?? "UTC",
      enabled: r.enabled,
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
      const { data } = await client.from(t).insert({
        id, name: input.name, description: input.description,
        schedule: input.schedule ?? null, run_at: input.runAt ?? null,
        agent_name: input.agentName, input: input.input,
        model: input.model ?? null, timezone: input.timezone ?? "UTC",
        enabled: input.enabled, next_run: input.nextRun ?? null,
        last_run: input.lastRun ?? null, scope_id: scopeId ?? null,
        created_at: now, updated_at: now,
      }).select().single();
      return rowToCronJob(data);
    },

    async get(id, scopeId?) {
      let query = client.from(t).select("*").eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data, error } = await query.single();
      if (error || !data) return null;
      return rowToCronJob(data);
    },

    async list(scopeId?) {
      let query = client.from(t).select("*");
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.order("created_at");
      return (data ?? []).map(rowToCronJob);
    },

    async update(id, updates, scopeId?) {
      const now = new Date().toISOString();
      const setValues: any = { updated_at: updates.updatedAt ?? now };
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.schedule !== undefined) setValues.schedule = updates.schedule;
      if (updates.runAt !== undefined) setValues.run_at = updates.runAt;
      if (updates.agentName !== undefined) setValues.agent_name = updates.agentName;
      if (updates.input !== undefined) setValues.input = updates.input;
      if (updates.model !== undefined) setValues.model = updates.model;
      if (updates.timezone !== undefined) setValues.timezone = updates.timezone;
      if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
      if (updates.nextRun !== undefined) setValues.next_run = updates.nextRun;
      if (updates.lastRun !== undefined) setValues.last_run = updates.lastRun;
      let query = client.from(t).update(setValues).eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select().single();
      return rowToCronJob(data);
    },

    async delete(id, scopeId?) {
      let query = client.from(t).delete().eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select("id");
      return (data?.length ?? 0) > 0;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      const { data } = await client.from(te).insert({
        id, cron_id: input.cronId, started_at: input.startedAt,
        completed_at: input.completedAt ?? null, status: input.status,
        summary: input.summary ?? null, error: input.error ?? null,
        scope_id: scopeId ?? null,
      }).select().single();
      return rowToExecution(data);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      let query = client.from(te).select("*").eq("cron_id", cronId);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.order("started_at", { ascending: false }).limit(limit);
      return (data ?? []).map(rowToExecution);
    },

    async updateExecution(id, updates, scopeId?) {
      const setValues: any = {};
      if (updates.completedAt !== undefined) setValues.completed_at = updates.completedAt;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.summary !== undefined) setValues.summary = updates.summary;
      if (updates.error !== undefined) setValues.error = updates.error;
      let query = client.from(te).update(setValues).eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select().single();
      return rowToExecution(data);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      let query = client.from(t).select("*").eq("enabled", true);
      if (scopeId) query = query.eq("scope_id", scopeId);
      // Supabase doesn't support complex OR conditions easily, so we fetch enabled jobs and filter
      const { data } = await query;
      return (data ?? [])
        .filter((r: any) => {
          const nextRun = r.next_run;
          const runAt = r.run_at;
          const lastRun = r.last_run;
          return (nextRun && nextRun <= iso) || (runAt && runAt <= iso && !lastRun);
        })
        .map(rowToCronJob)
        .sort((a: CronJob, b: CronJob) => {
          const aTime = a.nextRun ?? a.runAt ?? "";
          const bTime = b.nextRun ?? b.runAt ?? "";
          return aTime.localeCompare(bTime);
        });
    },
  };
}

// ── Job Store ──

function createJobStore(client: SupabaseClient, p: string): JobStore {
  const t = `${p}jobs`;

  function rowToJob(r: any): Job {
    return {
      id: r.id,
      agentName: r.agent_name,
      input: r.input ?? "",
      conversationId: r.conversation_id,
      scopeId: r.scope_id ?? undefined,
      status: r.status,
      result: r.result ?? undefined,
      error: r.error ?? undefined,
      usage: r.usage_prompt_tokens != null
        ? { promptTokens: r.usage_prompt_tokens, completionTokens: r.usage_completion_tokens, totalTokens: r.usage_total_tokens }
        : undefined,
      toolsUsed: r.tools_used ?? undefined,
      createdAt: r.created_at,
      startedAt: r.started_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { data } = await client.from(t).insert({
        id, agent_name: job.agentName, input: job.input,
        conversation_id: job.conversationId, scope_id: job.scopeId ?? null,
        status: job.status, result: job.result ?? null, error: job.error ?? null,
        usage_prompt_tokens: job.usage?.promptTokens ?? null,
        usage_completion_tokens: job.usage?.completionTokens ?? null,
        usage_total_tokens: job.usage?.totalTokens ?? null,
        tools_used: job.toolsUsed ?? null,
        created_at: now, started_at: job.startedAt ?? null, completed_at: job.completedAt ?? null,
      }).select().single();
      return rowToJob(data);
    },

    async get(id, scopeId?) {
      let query = client.from(t).select("*").eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data, error } = await query.single();
      if (error || !data) return null;
      return rowToJob(data);
    },

    async list(scopeId?) {
      let query = client.from(t).select("*");
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.order("created_at", { ascending: false });
      return (data ?? []).map(rowToJob);
    },

    async update(id, updates) {
      const setValues: any = {};
      if (updates.agentName !== undefined) setValues.agent_name = updates.agentName;
      if (updates.input !== undefined) setValues.input = updates.input;
      if (updates.conversationId !== undefined) setValues.conversation_id = updates.conversationId;
      if (updates.scopeId !== undefined) setValues.scope_id = updates.scopeId;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.result !== undefined) setValues.result = updates.result;
      if (updates.error !== undefined) setValues.error = updates.error;
      if (updates.startedAt !== undefined) setValues.started_at = updates.startedAt;
      if (updates.completedAt !== undefined) setValues.completed_at = updates.completedAt;
      if (updates.usage) {
        setValues.usage_prompt_tokens = updates.usage.promptTokens;
        setValues.usage_completion_tokens = updates.usage.completionTokens;
        setValues.usage_total_tokens = updates.usage.totalTokens;
      }
      if (updates.toolsUsed !== undefined) setValues.tools_used = updates.toolsUsed;
      const { data } = await client.from(t).update(setValues).eq("id", id).select().single();
      return rowToJob(data);
    },

    async delete(id, scopeId?) {
      let query = client.from(t).delete().eq("id", id);
      if (scopeId) query = query.eq("scope_id", scopeId);
      const { data } = await query.select("id");
      return (data?.length ?? 0) > 0;
    },
  };
}

// ── Factory ──

export async function createSupabaseStorage(config: SupabaseConfig): Promise<StorageProvider> {
  const { client } = config;
  const p = config.tablePrefix ?? "kitn_";

  if (config.autoMigrate !== false) {
    try {
      await runMigrations(client, p);
    } catch {
      // Auto-migrate requires the exec_sql RPC function or service role key.
      // If it fails, tables must be created manually.
      console.warn("[kitn] Supabase auto-migrate failed. Create tables manually or add the exec_sql RPC function.");
    }
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
