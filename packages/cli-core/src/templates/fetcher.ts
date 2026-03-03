import { mkdtemp, rm, readdir, readFile, writeFile, stat } from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { parseGitHubUrl, fetchGitHubTarball } from "./github.js";
import { extractTarGz, writeTarEntries } from "./tar.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchedTemplate {
  /** Absolute path to directory containing template files */
  dir: string;
  source: "github" | "local";
  /** Remove temporary directory (no-op for local templates) */
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Built-in: GitHub owner/repo/ref for kitn templates
// ---------------------------------------------------------------------------

const KITN_GITHUB = {
  owner: "kitn-ai",
  repo: "kitn",
  ref: "main",
} as const;

// ---------------------------------------------------------------------------
// Local fallback (moved from commands/new.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a bundled template directory.
 *
 * Strategy: walk up from this file's directory until we find a directory
 * containing `templates/<name>/package.json`. Works in:
 * - Dev: bun runs from source, walks up to repo root
 * - Dist: templates are copied to dist/templates/ during build
 */
async function resolveLocalTemplatePath(
  templateName: string,
): Promise<string | null> {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = join(thisFile, "..");

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "templates", templateName);
    try {
      const s = await stat(join(candidate, "package.json"));
      if (s.isFile()) return candidate;
    } catch {
      // not found, keep walking
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Copy a local template to a temp directory so callers always get the same
 * interface (temp dir + cleanup) regardless of source.
 */
async function copyLocalToTemp(srcDir: string): Promise<FetchedTemplate> {
  const tmpDir = await mkdtemp(join(tmpdir(), "kitn-tpl-"));
  await copyDirRecursive(srcDir, tmpDir);
  return {
    dir: tmpDir,
    source: "local",
    cleanup: () => rm(tmpDir, { recursive: true, force: true }),
  };
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a built-in kitn template (e.g. "hono").
 *
 * Tries GitHub first, falls back to local bundled templates if fetch fails.
 */
export async function fetchBuiltinTemplate(
  name: string,
): Promise<FetchedTemplate> {
  // Try GitHub first
  try {
    const tarball = await fetchGitHubTarball({
      ...KITN_GITHUB,
      subdir: `templates/${name}`,
    });

    const entries = await extractTarGz(tarball, {
      prefix: `templates/${name}`,
    });

    if (entries.length === 0) {
      throw new Error(`Template "${name}" not found in GitHub repository`);
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "kitn-tpl-"));
    await writeTarEntries(entries, tmpDir);

    return {
      dir: tmpDir,
      source: "github",
      cleanup: () => rm(tmpDir, { recursive: true, force: true }),
    };
  } catch (githubErr) {
    // Fall back to local templates
    const localPath = await resolveLocalTemplatePath(name);
    if (localPath) {
      return copyLocalToTemp(localPath);
    }

    // Neither source worked
    throw new Error(
      `Could not fetch template "${name}" from GitHub (${(githubErr as Error).message}), and no local fallback found.`,
    );
  }
}

/**
 * Fetch a custom template from a GitHub URL.
 *
 * Supports:
 * - `github:user/repo[/subdir][#branch]`
 * - `https://github.com/user/repo[/tree/branch/subdir]`
 */
export async function fetchCustomTemplate(
  url: string,
): Promise<FetchedTemplate> {
  const ref = parseGitHubUrl(url);
  const tarball = await fetchGitHubTarball(ref);
  const entries = await extractTarGz(tarball, {
    prefix: ref.subdir,
  });

  if (entries.length === 0) {
    const location = ref.subdir
      ? `${ref.owner}/${ref.repo}/${ref.subdir}`
      : `${ref.owner}/${ref.repo}`;
    throw new Error(`No files found in template at ${location}`);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "kitn-tpl-"));
  await writeTarEntries(entries, tmpDir);

  return {
    dir: tmpDir,
    source: "github",
    cleanup: () => rm(tmpDir, { recursive: true, force: true }),
  };
}
