import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { z } from "zod";

const componentType = z.enum(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:storage", "kitn:package", "kitn:cron"]);
type ComponentType = z.infer<typeof componentType>;

const installedComponentSchema = z.object({
  registry: z.string().optional(),
  type: componentType.optional(),
  slot: z.string().optional(),
  version: z.string(),
  installedAt: z.string(),
  files: z.array(z.string()),
  hash: z.string(),
  registryDependencies: z.array(z.string()).optional(),
});

const registryEntrySchema = z.object({
  url: z.string(),
  homepage: z.string().optional(),
  description: z.string().optional(),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

// Registries can be a plain URL string (backward compat) or a rich entry object
const registryValueSchema = z.union([z.string(), registryEntrySchema]);

export const DEFAULT_REGISTRY_URL = "https://kitn-ai.github.io/kitn/r/{type}/{name}.json";

export const DEFAULT_REGISTRIES: Record<string, z.infer<typeof registryValueSchema>> = {
  "@kitn": {
    url: DEFAULT_REGISTRY_URL,
    homepage: "https://kitn.ai",
    description: "Official kitn AI agent components",
  },
};

export const DEFAULT_ALIASES = {
  base: "src/ai",
  agents: "src/ai/agents",
  tools: "src/ai/tools",
  skills: "src/ai/skills",
  storage: "src/ai/storage",
  crons: "src/ai/crons",
} as const;

export const configSchema = z.object({
  $schema: z.string().optional(),
  runtime: z.enum(["bun", "node", "deno"]),
  framework: z.enum(["hono", "hono-openapi", "cloudflare", "elysia", "fastify", "express"]).optional(),
  aliases: z.object({
    base: z.string().optional(),
    agents: z.string(),
    tools: z.string(),
    skills: z.string(),
    storage: z.string(),
    crons: z.string().optional(),
  }),
  registries: z.record(z.string(), registryValueSchema),
  chatService: z.object({
    url: z.string().optional(),
  }).optional(),
});

export type KitnConfig = z.infer<typeof configSchema>;

/** Extract the URL from a registry entry (string or object). */
export function getRegistryUrl(entry: string | RegistryEntry): string {
  return typeof entry === "string" ? entry : entry.url;
}

const FRAMEWORK_TO_ADAPTER: Record<string, string> = {
  hono: "hono",
  "hono-openapi": "hono-openapi",
  elysia: "elysia",
};

export function resolveRoutesAlias(config: KitnConfig): string {
  const fw = config.framework ?? "hono";
  return FRAMEWORK_TO_ADAPTER[fw] ?? fw;
}

const CONFIG_FILE = "kitn.json";
const LOCK_FILE = "kitn.lock";

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

// --- Lock file (installed component tracking) ---

export const lockSchema = z.record(z.string(), installedComponentSchema);
export type LockFile = z.infer<typeof lockSchema>;

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

type RequiredAliasKey = "agents" | "tools" | "skills" | "storage" | "crons";

const typeToAliasKey: Record<Exclude<ComponentType, "kitn:package">, RequiredAliasKey> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
  "kitn:cron": "crons",
};

type SingleFileComponentType = Exclude<ComponentType, "kitn:package">;

export function getInstallPath(
  config: KitnConfig,
  type: SingleFileComponentType,
  fileName: string,
  namespace?: string,
): string {
  const aliasKey = typeToAliasKey[type];
  const baseAlias = config.aliases.base ?? "src/ai";
  const base = config.aliases[aliasKey] ?? join(baseAlias, aliasKey);
  if (namespace && namespace !== "@kitn") {
    const nsDir = namespace.replace("@", "");
    return join(base, nsDir, fileName);
  }
  return join(base, fileName);
}
