import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";

const componentType = z.enum(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:storage"]);
type ComponentType = z.infer<typeof componentType>;

const installedComponentSchema = z.object({
  version: z.string(),
  installedAt: z.string(),
  files: z.array(z.string()),
  hash: z.string(),
});

const configSchema = z.object({
  $schema: z.string().optional(),
  runtime: z.enum(["bun", "node", "deno"]),
  aliases: z.object({
    agents: z.string(),
    tools: z.string(),
    skills: z.string(),
    storage: z.string(),
  }),
  registries: z.record(z.string(), z.string()),
  _installed: z.record(z.string(), installedComponentSchema).optional(),
});

export type KitnConfig = z.infer<typeof configSchema>;

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

const typeToAliasKey: Record<ComponentType, keyof KitnConfig["aliases"]> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
};

export function getInstallPath(
  config: KitnConfig,
  type: ComponentType,
  fileName: string
): string {
  const aliasKey = typeToAliasKey[type];
  return join(config.aliases[aliasKey], fileName);
}
