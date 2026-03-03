import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { configSchema, lockSchema, lockComponentsSchema, CONFIG_FILE, LOCK_FILE } from "../types/config.js";
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
    const parsed = JSON.parse(raw);
    // New format: { lockfileVersion: 1, components: { ... } }
    if (parsed.lockfileVersion) {
      const doc = lockSchema.parse(parsed);
      return doc.components;
    }
    // Legacy flat format — parse as loose record, will fail if strict fields missing
    return lockComponentsSchema.parse(parsed);
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
  const doc = { lockfileVersion: 1 as const, components: lock };
  await writeFile(join(projectDir, LOCK_FILE), JSON.stringify(doc, null, 2) + "\n");
}
