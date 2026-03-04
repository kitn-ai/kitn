import { readFile, writeFile, mkdir, chmod, access, lstat, symlink } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { parseConfig, type ClawConfig } from "./schema.js";
import { CredentialStore } from "./credentials.js";

export const CLAW_HOME = join(homedir(), ".kitnclaw");
export const CONFIG_PATH = join(CLAW_HOME, "kitnclaw.json");
export const WORKSPACE = join(CLAW_HOME, "workspace");

const DIRS = [
  "",
  "sessions",
  "memory",
  "workspace",
  "workspace/agents",
  "workspace/tools",
  "workspace/skills",
  "credentials",
  "logs",
];

// Minimal kitn.json written to the workspace so registry tools work out of
// the box without needing `kitn init`. Paths are relative to the workspace dir.
const WORKSPACE_KITN_CONFIG = {
  runtime: "bun",
  aliases: {
    agents: "agents",
    tools: "tools",
    skills: "skills",
    storage: "storage",
  },
  registries: {
    "@kitn": {
      url: "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
      homepage: "https://kitn.ai",
      description: "Official kitn AI agent components",
    },
  },
};

export async function ensureClawHome(): Promise<void> {
  for (const dir of DIRS) {
    await mkdir(join(CLAW_HOME, dir), { recursive: true });
  }
  try {
    await chmod(join(CLAW_HOME, "credentials"), 0o700);
  } catch {
    // Non-critical — may fail on some platforms
  }

  // Initialize workspace kitn.json if missing so registry tools work immediately
  const workspaceConfig = join(WORKSPACE, "kitn.json");
  try {
    await access(workspaceConfig);
  } catch {
    await writeFile(workspaceConfig, JSON.stringify(WORKSPACE_KITN_CONFIG, null, 2));
  }

  // Symlink commonly-needed packages into workspace/node_modules so that
  // registry components (e.g. kitn add weather-agent) can import @kitn/core,
  // ai, and zod without needing their own package.json + install.
  await ensureWorkspaceDeps();
}

/**
 * Create symlinks in ~/.kitnclaw/workspace/node_modules/ pointing to claw's
 * own copies of @kitn/core (alias for @kitnai/core), ai, and zod.
 * Registry components import these packages; without this they fail to load.
 */
async function ensureWorkspaceDeps(): Promise<void> {
  const nodeModulesDir = join(WORKSPACE, "node_modules");

  // [link path parts, package to resolve from claw's context]
  const deps: Array<[string[], string]> = [
    [["@kitn", "core"], "@kitnai/core"],
    [["ai"], "ai"],
    [["zod"], "zod"],
  ];

  for (const [linkParts, resolveTarget] of deps) {
    const linkPath = join(nodeModulesDir, ...linkParts);

    // Skip if symlink/directory already exists
    try {
      await lstat(linkPath);
      continue;
    } catch {
      // Doesn't exist yet
    }

    // Resolve the real package directory using import.meta.resolve (handles
    // both workspace packages and regular npm packages in Bun's cache)
    let pkgDir: string | null = null;
    try {
      const url = await (import.meta as any).resolve(resolveTarget);
      let dir = dirname(new URL(url).pathname);
      while (dir !== dirname(dir)) {
        try {
          await access(join(dir, "package.json"));
          pkgDir = dir;
          break;
        } catch {
          dir = dirname(dir);
        }
      }
    } catch {
      // Package not resolvable from claw's context — skip
    }

    if (!pkgDir) continue;

    // Ensure the parent scope directory exists (e.g. node_modules/@kitn/)
    const linkParent = join(nodeModulesDir, ...linkParts.slice(0, -1));
    await mkdir(linkParent, { recursive: true });

    try {
      await symlink(pkgDir, linkPath);
    } catch {
      // Non-critical — may fail if already exists (race) or no permissions
    }
  }
}

export async function loadConfig(): Promise<ClawConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return parseConfig(JSON.parse(raw));
  } catch {
    return parseConfig({});
  }
}

export async function saveConfig(config: ClawConfig): Promise<void> {
  await ensureClawHome();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Non-critical
  }
}

export function getCredentialStore(): CredentialStore {
  return new CredentialStore({
    path: join(CLAW_HOME, "credentials"),
  });
}
