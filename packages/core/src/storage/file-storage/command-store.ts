import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandStore, CommandRegistration } from "../interfaces.js";

export function createCommandStore(dataDir: string): CommandStore {
  const baseDir = join(dataDir, "commands");

  let lock: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    let result: Promise<T>;
    lock = lock
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    return lock.then(() => result!);
  }

  /** Resolve the directory for a given scope (or the base dir for global). */
  function scopeDir(scopeId?: string): string {
    return scopeId ? join(baseDir, scopeId) : baseDir;
  }

  /** Resolve the file path for a command. */
  function filePath(name: string, scopeId?: string): string {
    return join(scopeDir(scopeId), `${name}.json`);
  }

  async function ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  return {
    async list(scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);

      const entries = await readdir(dir, { withFileTypes: true });
      const results: CommandRegistration[] = [];

      for (const entry of entries) {
        // Only read .json files directly in this directory (skip subdirectories)
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(dir, entry.name);
        try {
          const raw = await readFile(path, "utf-8");
          results.push(JSON.parse(raw));
        } catch {
          // Skip corrupt files
        }
      }

      return results;
    },

    async get(name, scopeId?) {
      const path = filePath(name, scopeId);
      if (!existsSync(path)) return undefined;
      try {
        const raw = await readFile(path, "utf-8");
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },

    save(command, scopeId?) {
      return withLock(async () => {
        const dir = scopeDir(scopeId);
        await ensureDir(dir);
        await writeFile(filePath(command.name, scopeId), JSON.stringify(command, null, 2));
      });
    },

    delete(name, scopeId?) {
      return withLock(async () => {
        const path = filePath(name, scopeId);
        if (!existsSync(path)) return;
        await unlink(path);
      });
    },
  };
}
