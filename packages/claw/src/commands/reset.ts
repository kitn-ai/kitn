import { rm, readdir } from "fs/promises";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

export type ResetTarget = "sessions" | "memory" | "workspace" | "all";

export async function resetData(targets: ResetTarget[]): Promise<string[]> {
  const cleared: string[] = [];

  const shouldReset = (t: ResetTarget) =>
    targets.includes("all") || targets.includes(t);

  if (shouldReset("sessions")) {
    const dir = join(CLAW_HOME, "sessions");
    const count = await clearDir(dir, ".jsonl");
    cleared.push(`Sessions: ${count} file(s) removed`);
  }

  if (shouldReset("memory")) {
    const dbPath = join(CLAW_HOME, "memory.db");
    try {
      await rm(dbPath, { force: true });
      // Also remove WAL/SHM files
      await rm(dbPath + "-wal", { force: true });
      await rm(dbPath + "-shm", { force: true });
      cleared.push("Memory: database removed");
    } catch {
      cleared.push("Memory: nothing to remove");
    }
  }

  if (shouldReset("workspace")) {
    for (const sub of ["tools", "agents", "skills"]) {
      const dir = join(CLAW_HOME, "workspace", sub);
      const count = await clearDir(dir);
      if (count > 0) {
        cleared.push(`Workspace ${sub}: ${count} file(s) removed`);
      }
    }
  }

  return cleared;
}

async function clearDir(dir: string, ext?: string): Promise<number> {
  try {
    const files = await readdir(dir);
    const toDelete = ext ? files.filter((f) => f.endsWith(ext)) : files;
    for (const file of toDelete) {
      await rm(join(dir, file), { force: true });
    }
    return toDelete.length;
  } catch {
    return 0;
  }
}
