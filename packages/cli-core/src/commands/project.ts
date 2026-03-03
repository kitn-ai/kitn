import { readConfig, readLock } from "../config/io.js";
import type { KitnConfig, LockFile } from "../types/config.js";

export interface ProjectContext {
  config: KitnConfig | null;
  lock: LockFile;
  installedComponents: Array<{ name: string; type: string; version: string }>;
  framework?: string;
  runtime?: string;
  hasKitnJson: boolean;
}

/**
 * Gather project context from kitn.json and kitn.lock.
 *
 * Returns a structured overview of the project's kitn configuration,
 * installed components, and detected framework/runtime.
 */
export async function getProjectContext(opts: {
  cwd: string;
}): Promise<ProjectContext> {
  const { cwd } = opts;

  const config = await readConfig(cwd);
  const lock = await readLock(cwd);

  const installedComponents = Object.entries(lock).map(([name, entry]) => ({
    name,
    type: entry.type.replace("kitn:", ""),
    version: entry.version,
  }));

  return {
    config,
    lock,
    installedComponents,
    framework: config?.framework ?? undefined,
    runtime: config?.runtime,
    hasKitnJson: config !== null,
  };
}
