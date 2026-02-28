import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CronStore, CronJob, CronExecution } from "../interfaces.js";

export function createCronStore(dataDir: string): CronStore {
  const baseDir = join(dataDir, "crons");

  let lock: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    let result: Promise<T>;
    lock = lock
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    return lock.then(() => result!);
  }

  function scopeDir(scopeId?: string): string {
    return scopeId ? join(baseDir, scopeId) : baseDir;
  }

  function jobsDir(scopeId?: string): string {
    return join(scopeDir(scopeId), "jobs");
  }

  function historyDir(cronId: string, scopeId?: string): string {
    return join(scopeDir(scopeId), "history", cronId);
  }

  function jobPath(id: string, scopeId?: string): string {
    return join(jobsDir(scopeId), `${id}.json`);
  }

  async function ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  async function readJson<T>(path: string): Promise<T | null> {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(await readFile(path, "utf-8"));
    } catch {
      return null;
    }
  }

  return {
    create(input, scopeId?) {
      return withLock(async () => {
        const now = new Date().toISOString();
        const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job: CronJob = { ...input, id, createdAt: now, updatedAt: now };
        await ensureDir(jobsDir(scopeId));
        await writeFile(jobPath(id, scopeId), JSON.stringify(job, null, 2));
        return job;
      });
    },

    async get(id, scopeId?) {
      return readJson<CronJob>(jobPath(id, scopeId));
    },

    async list(scopeId?) {
      const dir = jobsDir(scopeId);
      await ensureDir(dir);
      const entries = await readdir(dir, { withFileTypes: true });
      const results: CronJob[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const job = await readJson<CronJob>(join(dir, entry.name));
        if (job) results.push(job);
      }
      return results;
    },

    update(id, updates, scopeId?) {
      return withLock(async () => {
        const job = await readJson<CronJob>(jobPath(id, scopeId));
        if (!job) throw new Error(`Cron job not found: ${id}`);
        const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
        await writeFile(jobPath(id, scopeId), JSON.stringify(updated, null, 2));
        return updated;
      });
    },

    delete(id, scopeId?) {
      return withLock(async () => {
        const path = jobPath(id, scopeId);
        if (!existsSync(path)) return false;
        await unlink(path);
        return true;
      });
    },

    addExecution(input, scopeId?) {
      return withLock(async () => {
        const id = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const exec: CronExecution = { ...input, id };
        const dir = historyDir(input.cronId, scopeId);
        await ensureDir(dir);
        await writeFile(join(dir, `${id}.json`), JSON.stringify(exec, null, 2));
        return exec;
      });
    },

    async listExecutions(cronId, limit?, scopeId?) {
      const dir = historyDir(cronId, scopeId);
      await ensureDir(dir);
      const entries = await readdir(dir, { withFileTypes: true });
      const results: CronExecution[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const exec = await readJson<CronExecution>(join(dir, entry.name));
        if (exec) results.push(exec);
      }
      // Sort newest first by startedAt
      results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return limit ? results.slice(0, limit) : results;
    },

    updateExecution(id, updates, scopeId?) {
      return withLock(async () => {
        // Search across all history dirs for this execution
        const base = scopeDir(scopeId);
        const histBase = join(base, "history");
        await ensureDir(histBase);
        const cronDirs = await readdir(histBase, { withFileTypes: true });
        for (const cronDir of cronDirs) {
          if (!cronDir.isDirectory()) continue;
          const execPath = join(histBase, cronDir.name, `${id}.json`);
          const exec = await readJson<CronExecution>(execPath);
          if (exec) {
            const updated = { ...exec, ...updates };
            await writeFile(execPath, JSON.stringify(updated, null, 2));
            return updated;
          }
        }
        throw new Error(`Execution not found: ${id}`);
      });
    },

    async getDueJobs(now, scopeId?) {
      const all = await this.list(scopeId);
      return all.filter((job) => {
        if (!job.enabled) return false;
        if (job.schedule && job.nextRun) return new Date(job.nextRun) <= now;
        if (job.runAt && !job.lastRun) return new Date(job.runAt) <= now;
        return false;
      });
    },
  };
}
