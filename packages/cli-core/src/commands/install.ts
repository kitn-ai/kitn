import { join } from "path";
import { readFile } from "fs/promises";
import { readConfig, readLock } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { typeToDir } from "../types/registry.js";
import type { RegistryItem } from "../types/registry.js";
import type { LockFile } from "../types/config.js";
import { contentHash } from "../utils/hash.js";
import { getInstallPath } from "../types/config.js";
import type { ComponentType } from "../types/registry.js";
import { rewriteKitnImports } from "../installers/import-rewriter.js";
import { writeComponentFile } from "../installers/file-writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallFromLockOpts {
  cwd: string;
  /** Fail if lock file is inconsistent or local files differ (CI mode). */
  frozen?: boolean;
}

export interface InstallResult {
  installed: Array<{ name: string; files: string[] }>;
  skipped: Array<{ name: string; reason: string }>;
  npmDeps: string[];
  npmDevDeps: string[];
  errors: Array<{ component: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Main: installFromLock
// ---------------------------------------------------------------------------

/**
 * Install components from kitn.lock (like npm ci).
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * Reads kitn.lock, fetches each component at its recorded version from the
 * registry, and writes files to disk. Skips components whose files already
 * exist with matching hashes.
 */
export async function installFromLock(opts: InstallFromLockOpts): Promise<InstallResult> {
  const { cwd, frozen } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);
  const entries = Object.entries(lock);

  if (entries.length === 0) {
    return { installed: [], skipped: [], npmDeps: [], npmDevDeps: [], errors: [] };
  }

  const fetcher = new RegistryFetcher(config.registries);
  const installed: InstallResult["installed"] = [];
  const skipped: InstallResult["skipped"] = [];
  const allDeps: string[] = [];
  const allDevDeps: string[] = [];
  const errors: InstallResult["errors"] = [];

  for (const [name, entry] of entries) {
    try {
      // Check if all files exist with matching hash
      const filesExist = await checkFilesMatchHash(cwd, entry.files, entry.hash, entry.type);

      if (filesExist) {
        skipped.push({ name, reason: "files exist with matching hash" });
        continue;
      }

      // In frozen mode, fail if local files differ
      if (frozen) {
        const hasLocalFiles = await anyFileExists(cwd, entry.files);
        if (hasLocalFiles) {
          throw new Error("local files differ from lock (--frozen mode)");
        }
      }

      // Fetch the component at its exact version
      const registry = entry.registry ?? "@kitn";
      const type = entry.type ?? "kitn:agent";
      const dir = typeToDir[type];
      const version = entry.version;

      let item: RegistryItem;
      try {
        item = await fetcher.fetchItem(name, dir as any, registry, version);
      } catch (fetchErr: any) {
        if (frozen) {
          throw new Error(`cannot fetch at exact version ${version}: ${fetchErr.message}`);
        }
        // Try without version
        item = await fetcher.fetchItem(name, dir as any, registry);
      }

      // Collect npm deps
      if (item.dependencies) allDeps.push(...item.dependencies);
      if (item.devDependencies) allDevDeps.push(...item.devDependencies);

      // Write files
      const writtenFiles: string[] = [];

      if (type === "kitn:package") {
        const baseDir = config.aliases.base ?? "src/ai";
        for (const file of item.files) {
          const targetPath = join(cwd, baseDir, file.path);
          await writeComponentFile(targetPath, file.content);
          writtenFiles.push(join(baseDir, file.path));
        }
      } else {
        // Parse namespace from the component key
        const ns = name.includes("/") ? name.split("/").slice(0, -1).join("/") : registry;
        for (const file of item.files) {
          const fileName = file.path.split("/").pop()!;
          const installPath = getInstallPath(config, type as Exclude<ComponentType, "kitn:package">, fileName, ns);
          const targetPath = join(cwd, installPath);
          const content = rewriteKitnImports(file.content, type, fileName, config.aliases);
          await writeComponentFile(targetPath, content);
          writtenFiles.push(installPath);
        }
      }

      installed.push({ name, files: writtenFiles });
    } catch (err: any) {
      errors.push({ component: name, error: err.message });
    }
  }

  const uniqueDeps = [...new Set(allDeps)];
  const uniqueDevDeps = [...new Set(allDevDeps)].filter((d) => !uniqueDeps.includes(d));

  return { installed, skipped, npmDeps: uniqueDeps, npmDevDeps: uniqueDevDeps, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkFilesMatchHash(
  cwd: string,
  files: string[],
  expectedHash: string,
  type?: string,
): Promise<boolean> {
  try {
    const contents: string[] = [];
    for (const filePath of files) {
      const fullPath = join(cwd, filePath);
      const content = await readFile(fullPath, "utf-8");
      contents.push(content);
    }
    const hash = contentHash(contents.join("\n"));
    return hash === expectedHash;
  } catch {
    return false;
  }
}

async function anyFileExists(cwd: string, files: string[]): Promise<boolean> {
  for (const filePath of files) {
    try {
      await readFile(join(cwd, filePath), "utf-8");
      return true;
    } catch {
      // File doesn't exist
    }
  }
  return false;
}
