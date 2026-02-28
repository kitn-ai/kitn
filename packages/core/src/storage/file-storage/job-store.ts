import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { JobStore, Job } from "../interfaces.js";

export function createFileJobStore(dataDir: string): JobStore {
  const baseDir = join(dataDir, "jobs");

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

  function jobPath(id: string, scopeId?: string): string {
    return join(scopeDir(scopeId), `${id}.json`);
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
    create(input) {
      return withLock(async () => {
        const now = new Date().toISOString();
        const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job: Job = { ...input, id, createdAt: now };
        await ensureDir(scopeDir(input.scopeId));
        await writeFile(jobPath(id, input.scopeId), JSON.stringify(job, null, 2));
        return job;
      });
    },

    async get(id, scopeId?) {
      return readJson<Job>(jobPath(id, scopeId));
    },

    async list(scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);
      const entries = await readdir(dir, { withFileTypes: true });
      const results: Job[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const job = await readJson<Job>(join(dir, entry.name));
        if (job) results.push(job);
      }
      return results;
    },

    update(id, updates) {
      return withLock(async () => {
        // Try to find the job — check base dir first, then scan scope dirs
        let path = jobPath(id);
        let job = await readJson<Job>(path);

        if (!job) {
          // Scan scope directories
          await ensureDir(baseDir);
          const dirs = await readdir(baseDir, { withFileTypes: true });
          for (const entry of dirs) {
            if (!entry.isDirectory()) continue;
            const scopePath = jobPath(id, entry.name);
            job = await readJson<Job>(scopePath);
            if (job) {
              path = scopePath;
              break;
            }
          }
        }

        if (!job) throw new Error(`Job not found: ${id}`);
        const updated = { ...job, ...updates };
        await writeFile(path, JSON.stringify(updated, null, 2));
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
  };
}
