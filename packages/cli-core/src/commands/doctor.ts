import { join } from "path";
import { readFile, readdir, access } from "fs/promises";
import { readConfig, readLock } from "../config/io.js";
import { contentHash } from "../utils/hash.js";
import { CONFIG_FILE, LOCK_FILE } from "../types/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorCheckOpts {
  cwd: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheckItem {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string[];
}

export interface DoctorResult {
  checks: DoctorCheckItem[];
  stats: {
    pass: number;
    warn: number;
    fail: number;
  };
}

// ---------------------------------------------------------------------------
// Main: doctorCheck
// ---------------------------------------------------------------------------

/**
 * Run health checks on a kitn project.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Checks:
 * 1. kitn.json validity
 * 2. kitn.lock validity
 * 3. All files in lock entries exist on disk
 * 4. Content hashes match lock
 * 5. node_modules exists
 * 6. Orphaned .ts files in component dirs not tracked by lock
 */
export async function doctorCheck(opts: DoctorCheckOpts): Promise<DoctorResult> {
  const { cwd } = opts;
  const checks: DoctorCheckItem[] = [];

  // Check 1: kitn.json validity
  const config = await readConfig(cwd);
  if (config) {
    checks.push({
      name: "kitn.json",
      status: "pass",
      message: "Valid kitn.json found",
    });
  } else {
    const configExists = await fileExists(join(cwd, CONFIG_FILE));
    if (configExists) {
      checks.push({
        name: "kitn.json",
        status: "fail",
        message: "kitn.json exists but is invalid",
        details: ["File exists but could not be parsed. Check JSON syntax and schema."],
      });
    } else {
      checks.push({
        name: "kitn.json",
        status: "fail",
        message: "No kitn.json found",
        details: ['Run "kitn init" to create one.'],
      });
    }
  }

  // Check 2: kitn.lock validity
  const lockExists = await fileExists(join(cwd, LOCK_FILE));
  const lock = await readLock(cwd);
  const lockEntries = Object.entries(lock);

  if (lockExists && lockEntries.length > 0) {
    checks.push({
      name: "kitn.lock",
      status: "pass",
      message: `Valid kitn.lock with ${lockEntries.length} component(s)`,
    });
  } else if (lockExists && lockEntries.length === 0) {
    checks.push({
      name: "kitn.lock",
      status: "warn",
      message: "kitn.lock exists but is empty or invalid",
    });
  } else {
    checks.push({
      name: "kitn.lock",
      status: "pass",
      message: "No kitn.lock (no components installed)",
    });
  }

  // Check 3: All files in lock entries exist on disk
  const missingFiles: string[] = [];
  for (const [name, entry] of lockEntries) {
    for (const filePath of entry.files) {
      const fullPath = join(cwd, filePath);
      if (!(await fileExists(fullPath))) {
        missingFiles.push(`${name}: ${filePath}`);
      }
    }
  }

  if (missingFiles.length === 0 && lockEntries.length > 0) {
    checks.push({
      name: "Component files",
      status: "pass",
      message: "All component files exist on disk",
    });
  } else if (missingFiles.length > 0) {
    checks.push({
      name: "Component files",
      status: "fail",
      message: `${missingFiles.length} missing file(s)`,
      details: missingFiles,
    });
  }

  // Check 4: Content integrity matches lock
  const modifiedComponents: string[] = [];
  for (const [name, entry] of lockEntries) {
    try {
      const contents: string[] = [];
      for (const filePath of entry.files) {
        const fullPath = join(cwd, filePath);
        const content = await readFile(fullPath, "utf-8");
        contents.push(content);
      }
      if (contentHash(contents.join("\n")) !== entry.integrity) {
        modifiedComponents.push(name);
      }
    } catch {
      // File missing — already caught in check 3
    }
  }

  if (modifiedComponents.length === 0 && lockEntries.length > 0) {
    checks.push({
      name: "Integrity",
      status: "pass",
      message: "All component integrity hashes match lock file",
    });
  } else if (modifiedComponents.length > 0) {
    checks.push({
      name: "Integrity",
      status: "warn",
      message: `${modifiedComponents.length} component(s) modified locally`,
      details: modifiedComponents.map((c) => `${c} (local modifications detected)`),
    });
  }

  // Check 5: node_modules exists
  const nodeModulesExists = await fileExists(join(cwd, "node_modules"));
  if (nodeModulesExists) {
    checks.push({
      name: "node_modules",
      status: "pass",
      message: "node_modules directory exists",
    });
  } else {
    checks.push({
      name: "node_modules",
      status: "fail",
      message: "node_modules directory is missing",
      details: ["Run your package manager's install command (e.g. bun install, npm install)."],
    });
  }

  // Check 6: Orphaned .ts files in component dirs not tracked by lock
  if (config && lockEntries.length > 0) {
    const trackedFiles = new Set<string>();
    for (const [, entry] of lockEntries) {
      for (const filePath of entry.files) {
        trackedFiles.add(filePath);
      }
    }

    const componentDirs = new Set<string>();
    componentDirs.add(config.aliases.agents);
    componentDirs.add(config.aliases.tools);
    componentDirs.add(config.aliases.skills);
    componentDirs.add(config.aliases.storage);
    if (config.aliases.crons) componentDirs.add(config.aliases.crons);

    const orphanedFiles: string[] = [];
    for (const dir of componentDirs) {
      const fullDir = join(cwd, dir);
      try {
        const files = await readdir(fullDir);
        for (const file of files) {
          if (!file.endsWith(".ts")) continue;
          const relativePath = join(dir, file);
          if (!trackedFiles.has(relativePath)) {
            orphanedFiles.push(relativePath);
          }
        }
      } catch {
        // Directory doesn't exist — that's fine
      }
    }

    if (orphanedFiles.length === 0) {
      checks.push({
        name: "Orphaned files",
        status: "pass",
        message: "No orphaned files in component directories",
      });
    } else {
      checks.push({
        name: "Orphaned files",
        status: "warn",
        message: `${orphanedFiles.length} orphaned file(s) not tracked by lock`,
        details: orphanedFiles,
      });
    }
  }

  // Compute stats
  const stats = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    stats[check.status]++;
  }

  return { checks, stats };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
