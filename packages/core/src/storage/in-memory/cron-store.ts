import type { CronStore, CronJob, CronExecution } from "../interfaces.js";

export function createCronStore(): CronStore {
  const jobs = new Map<string, CronJob>();
  const executions = new Map<string, CronExecution[]>();
  let nextJobId = 1;
  let nextExecId = 1;

  function key(id: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${id}` : `:${id}`;
  }

  function prefix(scopeId?: string): string {
    return scopeId ? `${scopeId}:` : `:`;
  }

  return {
    async create(input, scopeId?) {
      const now = new Date().toISOString();
      const id = `cron_${nextJobId++}`;
      const job: CronJob = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(key(id, scopeId), job);
      return job;
    },

    async get(id, scopeId?) {
      return jobs.get(key(id, scopeId)) ?? null;
    },

    async list(scopeId?) {
      const p = prefix(scopeId);
      const results: CronJob[] = [];
      for (const [k, v] of jobs) {
        if (k.startsWith(p)) results.push(v);
      }
      return results;
    },

    async update(id, updates, scopeId?) {
      const k = key(id, scopeId);
      const job = jobs.get(k);
      if (!job) throw new Error(`Cron job not found: ${id}`);
      const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
      jobs.set(k, updated);
      return updated;
    },

    async delete(id, scopeId?) {
      return jobs.delete(key(id, scopeId));
    },

    async addExecution(input, scopeId?) {
      const id = `exec_${nextExecId++}`;
      const exec: CronExecution = { ...input, id };
      const cronKey = key(input.cronId, scopeId);
      const list = executions.get(cronKey) ?? [];
      list.push(exec);
      executions.set(cronKey, list);
      return exec;
    },

    async listExecutions(cronId, limit?, scopeId?) {
      const cronKey = key(cronId, scopeId);
      const list = executions.get(cronKey) ?? [];
      const sorted = [...list].reverse(); // newest first
      return limit ? sorted.slice(0, limit) : sorted;
    },

    async updateExecution(id, updates, scopeId?) {
      for (const [, list] of executions) {
        const idx = list.findIndex((e) => e.id === id);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updates };
          return list[idx];
        }
      }
      throw new Error(`Execution not found: ${id}`);
    },

    async getDueJobs(now, scopeId?) {
      const all = await this.list(scopeId);
      return all.filter((job) => {
        if (!job.enabled) return false;
        // Recurring: nextRun <= now
        if (job.schedule && job.nextRun) {
          return new Date(job.nextRun) <= now;
        }
        // One-off: runAt <= now and never ran
        if (job.runAt && !job.lastRun) {
          return new Date(job.runAt) <= now;
        }
        return false;
      });
    },
  };
}
