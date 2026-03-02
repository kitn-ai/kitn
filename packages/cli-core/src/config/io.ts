import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { configSchema, lockSchema, CONFIG_FILE, LOCK_FILE } from "../types/config.js";
import type { KitnConfig, LockFile } from "../types/config.js";

export async function readConfig(projectDir: string): Promise<KitnConfig | null> {
  try {
    const raw = await readFile(join(projectDir, CONFIG_FILE), "utf-8");
    return configSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeConfig(projectDir: string, config: KitnConfig): Promise<void> {
  const data = { $schema: "https://kitn.dev/schema/config.json", ...config };
  await writeFile(join(projectDir, CONFIG_FILE), JSON.stringify(data, null, 2) + "\n");
}

export async function readLock(projectDir: string): Promise<LockFile> {
  try {
    const raw = await readFile(join(projectDir, LOCK_FILE), "utf-8");
    return lockSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function writeLock(projectDir: string, lock: LockFile): Promise<void> {
  if (Object.keys(lock).length === 0) {
    try {
      await unlink(join(projectDir, LOCK_FILE));
    } catch {
      // File doesn't exist — nothing to delete
    }
    return;
  }
  await writeFile(join(projectDir, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");
}
