import type { JobStore, Job } from "../interfaces.js";

export function createJobStore(): JobStore {
  const jobs = new Map<string, Job>();
  let nextId = 1;

  function key(id: string, scopeId?: string): string {
    return scopeId ? `${scopeId}:${id}` : `:${id}`;
  }

  function prefix(scopeId?: string): string {
    return scopeId ? `${scopeId}:` : `:`;
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      const id = `job_${nextId++}`;
      const job: Job = {
        ...input,
        id,
        createdAt: now,
      };
      jobs.set(key(id, input.scopeId), job);
      return job;
    },

    async get(id, scopeId?) {
      return jobs.get(key(id, scopeId)) ?? null;
    },

    async list(scopeId?) {
      const p = prefix(scopeId);
      const results: Job[] = [];
      for (const [k, v] of jobs) {
        if (k.startsWith(p)) results.push(v);
      }
      return results;
    },

    async update(id, updates) {
      // Search all keys for this id since updates don't include scopeId
      for (const [k, job] of jobs) {
        if (job.id === id) {
          const updated = { ...job, ...updates };
          jobs.set(k, updated);
          return updated;
        }
      }
      throw new Error(`Job not found: ${id}`);
    },

    async delete(id, scopeId?) {
      return jobs.delete(key(id, scopeId));
    },
  };
}
