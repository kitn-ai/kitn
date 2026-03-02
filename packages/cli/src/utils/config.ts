import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";

// Re-export types and pure functions from cli-core
export {
  installedComponentSchema,
  type RegistryEntry,
  type RegistryValue,
  DEFAULT_REGISTRY_URL,
  DEFAULT_REGISTRIES,
  DEFAULT_ALIASES,
  configSchema,
  type KitnConfig,
  getRegistryUrl,
  resolveRoutesAlias,
  lockSchema,
  type LockFile,
  CONFIG_FILE,
  LOCK_FILE,
  getInstallPath,
} from "@kitnai/cli-core";

import { configSchema, lockSchema, CONFIG_FILE, LOCK_FILE } from "@kitnai/cli-core";
import type { KitnConfig, LockFile } from "@kitnai/cli-core";

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
