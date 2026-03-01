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

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...args: (string | number)[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zcard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
}

interface RedisConfig {
  client: RedisClient;
  keyPrefix?: string;
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

function ts(): string { return new Date().toISOString(); }
function tsScore(iso?: string): number { return iso ? new Date(iso).getTime() : Date.now(); }

// ── Conversation Store ──

function createConversationStore(r: RedisClient, k: string): ConversationStore {
  const convKey = (id: string) => `${k}conv:${id}`;
  const msgsKey = (id: string) => `${k}conv:${id}:msgs`;
  const indexKey = `${k}conv:index`;

  return {
    async get(id, scopeId?) {
      const data = await r.hgetall(convKey(id));
      if (!data || !data.id) return null;
      if (scopeId && data.scope_id !== scopeId) return null;
      const rawMsgs = await r.zrange(msgsKey(id), 0, -1);
      const messages: ConversationMessage[] = rawMsgs.map((m) => JSON.parse(m));
      return {
        id: data.id,
        messages,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async list(scopeId?) {
      const ids = await r.smembers(indexKey);
      const summaries: ConversationSummary[] = [];
      for (const id of ids) {
        const data = await r.hgetall(convKey(id));
        if (!data || !data.id) continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        const count = await r.zcard(msgsKey(id));
        summaries.push({ id: data.id, messageCount: count, updatedAt: data.updated_at });
      }
      summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return summaries;
    },

    async create(id, scopeId?) {
      const now = ts();
      await r.hset(convKey(id), "id", id, "scope_id", scopeId ?? "", "created_at", now, "updated_at", now);
      await r.sadd(indexKey, id);
      return { id, messages: [], createdAt: now, updatedAt: now };
    },

    async append(id, message, scopeId?) {
      const now = ts();
      const exists = await r.sismember(indexKey, id);
      if (!exists) {
        await r.hset(convKey(id), "id", id, "scope_id", scopeId ?? "", "created_at", now, "updated_at", now);
        await r.sadd(indexKey, id);
      } else {
        await r.hset(convKey(id), "updated_at", now);
      }
      const score = tsScore(message.timestamp);
      await r.zadd(msgsKey(id), score, JSON.stringify(message));
      return (await this.get(id, scopeId))!;
    },

    async delete(id, scopeId?) {
      if (scopeId) {
        const data = await r.hgetall(convKey(id));
        if (data.scope_id !== scopeId) return false;
      }
      const existed = await r.sismember(indexKey, id);
      await r.del(convKey(id), msgsKey(id));
      await r.srem(indexKey, id);
      return existed > 0;
    },

    async clear(id, scopeId?) {
      const now = ts();
      await r.del(msgsKey(id));
      await r.hset(convKey(id), "updated_at", now);
      return (await this.get(id, scopeId))!;
    },
  };
}

// ── Memory Store ──

function createMemoryStore(r: RedisClient, k: string): MemoryStore {
  const entryKey = (ns: string, key: string, scope?: string) => `${k}mem:${ns}:${key}:${scope ?? ""}`;
  const nsIndexKey = `${k}mem:ns:index`;
  const nsEntriesKey = (ns: string) => `${k}mem:ns:${ns}:entries`;

  return {
    async listNamespaces(scopeId?) {
      const namespaces = await r.smembers(nsIndexKey);
      if (!scopeId) return namespaces;
      // Filter namespaces that have entries with this scopeId
      const result: string[] = [];
      for (const ns of namespaces) {
        const entryKeys = await r.smembers(nsEntriesKey(ns));
        for (const ek of entryKeys) {
          const data = await r.hgetall(ek);
          if (data.scope_id === scopeId || (!scopeId && !data.scope_id)) {
            result.push(ns);
            break;
          }
        }
      }
      return result;
    },

    async listEntries(namespaceId, scopeId?) {
      const entryKeys = await r.smembers(nsEntriesKey(namespaceId));
      const entries: MemoryEntry[] = [];
      for (const ek of entryKeys) {
        const data = await r.hgetall(ek);
        if (!data || !data.key) continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        if (!scopeId && data.scope_id) continue;
        entries.push({
          key: data.key,
          value: data.value,
          context: data.context ?? "",
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      }
      return entries;
    },

    async saveEntry(namespaceId, key, value, context = "", scopeId?) {
      const now = ts();
      const ek = entryKey(namespaceId, key, scopeId);
      const existing = await r.hget(ek, "created_at");
      const createdAt = existing ?? now;
      await r.hset(ek, "key", key, "value", value, "context", context, "scope_id", scopeId ?? "", "created_at", createdAt, "updated_at", now);
      await r.sadd(nsIndexKey, namespaceId);
      await r.sadd(nsEntriesKey(namespaceId), ek);
      return { key, value, context, createdAt, updatedAt: now };
    },

    async getEntry(namespaceId, key, scopeId?) {
      const ek = entryKey(namespaceId, key, scopeId);
      const data = await r.hgetall(ek);
      if (!data || !data.key) return null;
      return {
        key: data.key,
        value: data.value,
        context: data.context ?? "",
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async deleteEntry(namespaceId, key, scopeId?) {
      const ek = entryKey(namespaceId, key, scopeId);
      const existed = await r.hget(ek, "key");
      if (!existed) return false;
      await r.del(ek);
      await r.srem(nsEntriesKey(namespaceId), ek);
      return true;
    },

    async clearNamespace(namespaceId, scopeId?) {
      const entryKeys = await r.smembers(nsEntriesKey(namespaceId));
      for (const ek of entryKeys) {
        if (scopeId) {
          const data = await r.hgetall(ek);
          if (data.scope_id !== scopeId) continue;
        }
        await r.del(ek);
        await r.srem(nsEntriesKey(namespaceId), ek);
      }
      // Remove namespace from index if empty
      const remaining = await r.smembers(nsEntriesKey(namespaceId));
      if (!remaining.length) {
        await r.srem(nsIndexKey, namespaceId);
      }
    },

    async loadMemoriesForIds(ids, scopeId?) {
      const results: Array<MemoryEntry & { namespace: string }> = [];
      for (const ns of ids) {
        const entryKeys = await r.smembers(nsEntriesKey(ns));
        for (const ek of entryKeys) {
          const data = await r.hgetall(ek);
          if (!data || !data.key) continue;
          if (scopeId && data.scope_id !== scopeId) continue;
          if (!scopeId && data.scope_id) continue;
          results.push({
            namespace: ns,
            key: data.key,
            value: data.value,
            context: data.context ?? "",
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          });
        }
      }
      return results;
    },
  };
}

// ── Skill Store ──

function createSkillStore(r: RedisClient, k: string): SkillStore {
  const skillKey = (name: string) => `${k}skill:${name}`;
  const indexKey = `${k}skill:index`;

  function dataToSkill(data: Record<string, string>): Skill {
    return {
      name: data.name,
      description: data.description ?? "",
      tags: data.tags ? JSON.parse(data.tags) : [],
      phase: (data.phase ?? "both") as SkillPhase,
      content: data.content ?? "",
      rawContent: data.raw_content ?? "",
      updatedAt: data.updated_at,
    };
  }

  return {
    async listSkills() {
      const names = await r.smembers(indexKey);
      const skills: SkillMeta[] = [];
      for (const name of names.sort()) {
        const data = await r.hgetall(skillKey(name));
        if (!data || !data.name) continue;
        skills.push({
          name: data.name,
          description: data.description ?? "",
          tags: data.tags ? JSON.parse(data.tags) : [],
          phase: (data.phase ?? "both") as SkillPhase,
        });
      }
      return skills;
    },

    async getSkill(name) {
      const data = await r.hgetall(skillKey(name));
      if (!data || !data.name) return null;
      return dataToSkill(data);
    },

    async createSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = ts();
      await r.hset(skillKey(name),
        "name", name,
        "description", (meta.description as string) ?? "",
        "tags", JSON.stringify((meta.tags as string[]) ?? []),
        "phase", (meta.phase as string) ?? "both",
        "content", body,
        "raw_content", rawContent,
        "updated_at", now,
      );
      await r.sadd(indexKey, name);
      return (await this.getSkill(name))!;
    },

    async updateSkill(name, rawContent) {
      const { meta, body } = parseFrontmatter(rawContent);
      const now = ts();
      await r.hset(skillKey(name),
        "description", (meta.description as string) ?? "",
        "tags", JSON.stringify((meta.tags as string[]) ?? []),
        "phase", (meta.phase as string) ?? "both",
        "content", body,
        "raw_content", rawContent,
        "updated_at", now,
      );
      return (await this.getSkill(name))!;
    },

    async deleteSkill(name) {
      const existed = await r.sismember(indexKey, name);
      if (!existed) return false;
      await r.del(skillKey(name));
      await r.srem(indexKey, name);
      return true;
    },

    async getSkillSummaries() {
      const names = await r.smembers(indexKey);
      if (!names.length) return "";
      const lines: string[] = [];
      for (const name of names.sort()) {
        const desc = await r.hget(skillKey(name), "description");
        lines.push(`- ${name}: ${desc ?? ""}`);
      }
      return lines.join("\n");
    },
  };
}

// ── Task Store ──

function createTaskStore(r: RedisClient, k: string): TaskStore {
  const taskKey = (id: string) => `${k}task:${id}`;
  const indexKey = `${k}task:index`;

  function dataToTask(data: Record<string, string>): Task {
    return {
      id: data.id,
      title: data.title,
      status: data.status as Task["status"],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  return {
    async createTask(title) {
      const id = crypto.randomUUID();
      const now = ts();
      await r.hset(taskKey(id), "id", id, "title", title, "status", "todo", "created_at", now, "updated_at", now);
      await r.zadd(indexKey, tsScore(now), id);
      return { id, title, status: "todo", createdAt: now, updatedAt: now };
    },

    async listTasks() {
      const ids = await r.zrange(indexKey, 0, -1);
      const tasks: Task[] = [];
      for (const id of ids) {
        const data = await r.hgetall(taskKey(id));
        if (data && data.id) tasks.push(dataToTask(data));
      }
      return tasks;
    },

    async updateTask(id, updates) {
      const args: (string | number)[] = [];
      if (updates.title !== undefined) { args.push("title", updates.title); }
      if (updates.status !== undefined) { args.push("status", updates.status); }
      const now = ts();
      args.push("updated_at", now);
      await r.hset(taskKey(id), ...args);
      const data = await r.hgetall(taskKey(id));
      return dataToTask(data);
    },

    async deleteTask(id) {
      const data = await r.hgetall(taskKey(id));
      if (!data || !data.id) return false;
      await r.del(taskKey(id));
      await r.zrem(indexKey, id);
      return true;
    },
  };
}

// ── Prompt Store ──

function createPromptStore(r: RedisClient, k: string): PromptStore {
  const promptKey = (name: string) => `${k}prompt:${name}`;
  const indexKey = `${k}prompt:index`;

  return {
    async loadOverrides() {
      const names = await r.smembers(indexKey);
      const result: Record<string, PromptOverride> = {};
      for (const name of names) {
        const data = await r.hgetall(promptKey(name));
        if (data && data.prompt) {
          result[name] = { prompt: data.prompt, updatedAt: data.updated_at };
        }
      }
      return result;
    },

    async saveOverride(name, prompt) {
      const now = ts();
      await r.hset(promptKey(name), "prompt", prompt, "updated_at", now);
      await r.sadd(indexKey, name);
      return { prompt, updatedAt: now };
    },

    async deleteOverride(name) {
      const existed = await r.sismember(indexKey, name);
      if (!existed) return false;
      await r.del(promptKey(name));
      await r.srem(indexKey, name);
      return true;
    },
  };
}

// ── Command Store ──

function createCommandStore(r: RedisClient, k: string): CommandStore {
  const cmdKey = (scope: string, name: string) => `${k}cmd:${scope}:${name}`;
  const indexKey = (scope: string) => `${k}cmd:${scope}:index`;

  function dataToCommand(data: Record<string, string>): CommandRegistration {
    return {
      name: data.name,
      description: data.description ?? "",
      system: data.system ?? "",
      tools: data.tools ? JSON.parse(data.tools) : [],
      model: data.model || undefined,
      format: (data.format || undefined) as CommandRegistration["format"],
    };
  }

  return {
    async list(scopeId?) {
      const scope = scopeId ?? "";
      const names = await r.smembers(indexKey(scope));
      const commands: CommandRegistration[] = [];
      for (const name of names.sort()) {
        const data = await r.hgetall(cmdKey(scope, name));
        if (data && data.name) commands.push(dataToCommand(data));
      }
      return commands;
    },

    async get(name, scopeId?) {
      const scope = scopeId ?? "";
      const data = await r.hgetall(cmdKey(scope, name));
      if (!data || !data.name) return undefined;
      return dataToCommand(data);
    },

    async save(command, scopeId?) {
      const scope = scopeId ?? "";
      await r.hset(cmdKey(scope, command.name),
        "name", command.name,
        "description", command.description,
        "system", command.system,
        "tools", JSON.stringify(command.tools ?? []),
        "model", command.model ?? "",
        "format", command.format ?? "",
      );
      await r.sadd(indexKey(scope), command.name);
    },

    async delete(name, scopeId?) {
      const scope = scopeId ?? "";
      await r.del(cmdKey(scope, name));
      await r.srem(indexKey(scope), name);
    },
  };
}

// ── Cron Store ──

function createCronStore(r: RedisClient, k: string): CronStore {
  const cronKey = (id: string) => `${k}cron:${id}`;
  const indexKey = `${k}cron:index`;
  const execsKey = (cronId: string) => `${k}cron:${cronId}:execs`;
  const execKey = (id: string) => `${k}cron:exec:${id}`;

  function dataToCronJob(data: Record<string, string>): CronJob {
    return {
      id: data.id,
      name: data.name,
      description: data.description ?? "",
      schedule: data.schedule || undefined,
      runAt: data.run_at || undefined,
      agentName: data.agent_name,
      input: data.input ?? "",
      model: data.model || undefined,
      timezone: data.timezone || "UTC",
      enabled: data.enabled === "true",
      nextRun: data.next_run || undefined,
      lastRun: data.last_run || undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  function dataToExecution(data: Record<string, string>): CronExecution {
    return {
      id: data.id,
      cronId: data.cron_id,
      startedAt: data.started_at,
      completedAt: data.completed_at || undefined,
      status: data.status as CronExecution["status"],
      summary: data.summary || undefined,
      error: data.error || undefined,
    };
  }

  return {
    async create(input, scopeId?) {
      const id = crypto.randomUUID();
      const now = ts();
      await r.hset(cronKey(id),
        "id", id, "name", input.name, "description", input.description,
        "schedule", input.schedule ?? "", "run_at", input.runAt ?? "",
        "agent_name", input.agentName, "input", input.input,
        "model", input.model ?? "", "timezone", input.timezone ?? "UTC",
        "enabled", String(input.enabled), "next_run", input.nextRun ?? "",
        "last_run", input.lastRun ?? "", "scope_id", scopeId ?? "",
        "created_at", now, "updated_at", now,
      );
      await r.sadd(indexKey, id);
      const data = await r.hgetall(cronKey(id));
      return dataToCronJob(data);
    },

    async get(id, scopeId?) {
      const data = await r.hgetall(cronKey(id));
      if (!data || !data.id) return null;
      if (scopeId && data.scope_id !== scopeId) return null;
      return dataToCronJob(data);
    },

    async list(scopeId?) {
      const ids = await r.smembers(indexKey);
      const jobs: CronJob[] = [];
      for (const id of ids) {
        const data = await r.hgetall(cronKey(id));
        if (!data || !data.id) continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        jobs.push(dataToCronJob(data));
      }
      jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return jobs;
    },

    async update(id, updates, scopeId?) {
      const data = await r.hgetall(cronKey(id));
      if (scopeId && data.scope_id !== scopeId) throw new Error("Not found");
      const u: any = { ...updates };
      const now = u.updatedAt ?? ts();
      const args: (string | number)[] = ["updated_at", now];
      if (u.name !== undefined) args.push("name", u.name);
      if (u.description !== undefined) args.push("description", u.description);
      if (u.schedule !== undefined) args.push("schedule", u.schedule ?? "");
      if (u.runAt !== undefined) args.push("run_at", u.runAt ?? "");
      if (u.agentName !== undefined) args.push("agent_name", u.agentName);
      if (u.input !== undefined) args.push("input", u.input);
      if (u.model !== undefined) args.push("model", u.model ?? "");
      if (u.timezone !== undefined) args.push("timezone", u.timezone ?? "UTC");
      if (u.enabled !== undefined) args.push("enabled", String(u.enabled));
      if (u.nextRun !== undefined) args.push("next_run", u.nextRun ?? "");
      if (u.lastRun !== undefined) args.push("last_run", u.lastRun ?? "");
      await r.hset(cronKey(id), ...args);
      const updated = await r.hgetall(cronKey(id));
      return dataToCronJob(updated);
    },

    async delete(id, scopeId?) {
      if (scopeId) {
        const data = await r.hgetall(cronKey(id));
        if (data.scope_id !== scopeId) return false;
      }
      const existed = await r.sismember(indexKey, id);
      if (!existed) return false;
      // Clean up executions
      const execIds = await r.zrange(execsKey(id), 0, -1);
      for (const eid of execIds) {
        await r.del(execKey(eid));
      }
      await r.del(cronKey(id), execsKey(id));
      await r.srem(indexKey, id);
      return true;
    },

    async addExecution(input, scopeId?) {
      const id = crypto.randomUUID();
      await r.hset(execKey(id),
        "id", id, "cron_id", input.cronId,
        "started_at", input.startedAt,
        "completed_at", input.completedAt ?? "",
        "status", input.status,
        "summary", input.summary ?? "",
        "error", input.error ?? "",
        "scope_id", scopeId ?? "",
      );
      await r.zadd(execsKey(input.cronId), tsScore(input.startedAt), id);
      const data = await r.hgetall(execKey(id));
      return dataToExecution(data);
    },

    async listExecutions(cronId, limit = 50, scopeId?) {
      const ids = await r.zrevrange(execsKey(cronId), 0, limit - 1);
      const executions: CronExecution[] = [];
      for (const id of ids) {
        const data = await r.hgetall(execKey(id));
        if (!data || !data.id) continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        executions.push(dataToExecution(data));
      }
      return executions;
    },

    async updateExecution(id, updates, _scopeId?) {
      const args: (string | number)[] = [];
      if (updates.completedAt !== undefined) args.push("completed_at", updates.completedAt ?? "");
      if (updates.status !== undefined) args.push("status", updates.status);
      if (updates.summary !== undefined) args.push("summary", updates.summary ?? "");
      if (updates.error !== undefined) args.push("error", updates.error ?? "");
      if (args.length) await r.hset(execKey(id), ...args);
      const data = await r.hgetall(execKey(id));
      return dataToExecution(data);
    },

    async getDueJobs(now, scopeId?) {
      const iso = now.toISOString();
      const ids = await r.smembers(indexKey);
      const dueJobs: CronJob[] = [];
      for (const id of ids) {
        const data = await r.hgetall(cronKey(id));
        if (!data || !data.id) continue;
        if (data.enabled !== "true") continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        const nextRun = data.next_run || "";
        const runAt = data.run_at || "";
        const lastRun = data.last_run || "";
        if ((nextRun && nextRun <= iso) || (runAt && runAt <= iso && !lastRun)) {
          dueJobs.push(dataToCronJob(data));
        }
      }
      dueJobs.sort((a, b) => {
        const aTime = a.nextRun ?? a.runAt ?? "";
        const bTime = b.nextRun ?? b.runAt ?? "";
        return aTime.localeCompare(bTime);
      });
      return dueJobs;
    },
  };
}

// ── Job Store ──

function createJobStore(r: RedisClient, k: string): JobStore {
  const jobKey = (id: string) => `${k}job:${id}`;
  const indexKey = `${k}job:index`;

  function dataToJob(data: Record<string, string>): Job {
    return {
      id: data.id,
      agentName: data.agent_name,
      input: data.input ?? "",
      conversationId: data.conversation_id,
      scopeId: data.scope_id || undefined,
      status: data.status as Job["status"],
      result: data.result || undefined,
      error: data.error || undefined,
      usage: data.usage_prompt_tokens
        ? {
            promptTokens: Number(data.usage_prompt_tokens),
            completionTokens: Number(data.usage_completion_tokens),
            totalTokens: Number(data.usage_total_tokens),
          }
        : undefined,
      toolsUsed: data.tools_used ? JSON.parse(data.tools_used) : undefined,
      createdAt: data.created_at,
      startedAt: data.started_at || undefined,
      completedAt: data.completed_at || undefined,
    };
  }

  return {
    async create(job) {
      const id = crypto.randomUUID();
      const now = ts();
      await r.hset(jobKey(id),
        "id", id, "agent_name", job.agentName, "input", job.input,
        "conversation_id", job.conversationId, "scope_id", job.scopeId ?? "",
        "status", job.status, "result", job.result ?? "",
        "error", job.error ?? "",
        "usage_prompt_tokens", String(job.usage?.promptTokens ?? ""),
        "usage_completion_tokens", String(job.usage?.completionTokens ?? ""),
        "usage_total_tokens", String(job.usage?.totalTokens ?? ""),
        "tools_used", job.toolsUsed ? JSON.stringify(job.toolsUsed) : "",
        "created_at", now, "started_at", job.startedAt ?? "",
        "completed_at", job.completedAt ?? "",
      );
      await r.zadd(indexKey, tsScore(now), id);
      const data = await r.hgetall(jobKey(id));
      return dataToJob(data);
    },

    async get(id, scopeId?) {
      const data = await r.hgetall(jobKey(id));
      if (!data || !data.id) return null;
      if (scopeId && data.scope_id !== scopeId) return null;
      return dataToJob(data);
    },

    async list(scopeId?) {
      const ids = await r.zrevrange(indexKey, 0, -1);
      const jobs: Job[] = [];
      for (const id of ids) {
        const data = await r.hgetall(jobKey(id));
        if (!data || !data.id) continue;
        if (scopeId && data.scope_id !== scopeId) continue;
        jobs.push(dataToJob(data));
      }
      return jobs;
    },

    async update(id, updates) {
      const u: any = { ...updates };
      const args: (string | number)[] = [];
      if (u.agentName !== undefined) args.push("agent_name", u.agentName);
      if (u.input !== undefined) args.push("input", u.input);
      if (u.conversationId !== undefined) args.push("conversation_id", u.conversationId);
      if (u.scopeId !== undefined) args.push("scope_id", u.scopeId ?? "");
      if (u.status !== undefined) args.push("status", u.status);
      if (u.result !== undefined) args.push("result", u.result ?? "");
      if (u.error !== undefined) args.push("error", u.error ?? "");
      if (u.startedAt !== undefined) args.push("started_at", u.startedAt ?? "");
      if (u.completedAt !== undefined) args.push("completed_at", u.completedAt ?? "");
      if (u.usage) {
        args.push("usage_prompt_tokens", String(u.usage.promptTokens));
        args.push("usage_completion_tokens", String(u.usage.completionTokens));
        args.push("usage_total_tokens", String(u.usage.totalTokens));
      }
      if (u.toolsUsed !== undefined) args.push("tools_used", JSON.stringify(u.toolsUsed));
      if (args.length) await r.hset(jobKey(id), ...args);
      const data = await r.hgetall(jobKey(id));
      return dataToJob(data);
    },

    async delete(id, scopeId?) {
      if (scopeId) {
        const data = await r.hgetall(jobKey(id));
        if (data.scope_id !== scopeId) return false;
      }
      const data = await r.hgetall(jobKey(id));
      if (!data || !data.id) return false;
      await r.del(jobKey(id));
      await r.zrem(indexKey, id);
      return true;
    },
  };
}

// ── Factory ──

export async function createRedisStorage(config: RedisConfig): Promise<StorageProvider> {
  const { client } = config;
  const k = config.keyPrefix ?? "kitn:";

  // Redis is schema-less — no migration needed

  return {
    conversations: createConversationStore(client, k),
    memory: createMemoryStore(client, k),
    skills: createSkillStore(client, k),
    tasks: createTaskStore(client, k),
    prompts: createPromptStore(client, k),
    commands: createCommandStore(client, k),
    crons: createCronStore(client, k),
    jobs: createJobStore(client, k),
  };
}
