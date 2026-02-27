import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";

const componentType = z.enum(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:storage", "kitn:package"]);
type ComponentType = z.infer<typeof componentType>;

const installedComponentSchema = z.object({
  registry: z.string().optional(),
  version: z.string(),
  installedAt: z.string(),
  files: z.array(z.string()),
  hash: z.string(),
});

const registryEntrySchema = z.object({
  url: z.string(),
  homepage: z.string().optional(),
  description: z.string().optional(),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

// Registries can be a plain URL string (backward compat) or a rich entry object
const registryValueSchema = z.union([z.string(), registryEntrySchema]);

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
  }),
  registries: z.record(z.string(), registryValueSchema),
  installed: z.record(z.string(), installedComponentSchema).optional(),
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

type RequiredAliasKey = "agents" | "tools" | "skills" | "storage";

const typeToAliasKey: Record<Exclude<ComponentType, "kitn:package">, RequiredAliasKey> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
};

type SingleFileComponentType = Exclude<ComponentType, "kitn:package">;

export function getInstallPath(
  config: KitnConfig,
  type: SingleFileComponentType,
  fileName: string,
  namespace?: string,
): string {
  const aliasKey = typeToAliasKey[type];
  const base = config.aliases[aliasKey];
  if (namespace && namespace !== "@kitn") {
    const nsDir = namespace.replace("@", "");
    return join(base, nsDir, fileName);
  }
  return join(base, fileName);
}
