import { z } from "zod";

export const componentType = z.enum(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:storage", "kitn:package", "kitn:cron"]);
export type ComponentType = z.infer<typeof componentType>;

export const registryFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  type: componentType,
});

export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  type: z.enum(["feature", "fix", "breaking", "initial"]),
  note: z.string(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const envVarConfigSchema = z.object({
  description: z.string(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  url: z.string().optional(),
});
export type EnvVarConfig = z.infer<typeof envVarConfigSchema>;

/** Schema for the author-facing registry.json file */
export const componentConfigSchema = z.object({
  $schema: z.string().optional(),
  type: componentType,
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  sourceDir: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  installDir: z.string().optional(),
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),
  envVars: z.record(z.string(), envVarConfigSchema).optional(),
  categories: z.array(z.string()).optional(),
  slot: z.string().optional(),
  docs: z.string().optional(),
  changelog: z.array(changelogEntrySchema).optional(),
});
export type ComponentConfig = z.infer<typeof componentConfigSchema>;

export const registryItemSchema = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  type: componentType,
  description: z.string(),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  envVars: z.record(z.string(), envVarConfigSchema).optional(),
  files: z.array(registryFileSchema),
  installDir: z.string().optional(),
  tsconfig: z.record(z.string(), z.array(z.string())).optional(),
  docs: z.string().optional(),
  categories: z.array(z.string()).optional(),
  slot: z.string().optional(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
  changelog: z.array(changelogEntrySchema).optional(),
});
export type RegistryItem = z.infer<typeof registryItemSchema>;

export const registryIndexItemSchema = z.object({
  name: z.string(),
  type: componentType,
  description: z.string(),
  registryDependencies: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  slot: z.string().optional(),
  version: z.string().optional(),
  versions: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

export const registryIndexSchema = z.object({
  $schema: z.string().optional(),
  version: z.string(),
  items: z.array(registryIndexItemSchema),
});
export type RegistryIndex = z.infer<typeof registryIndexSchema>;

export const typeToDir: Record<ComponentType, string> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
  "kitn:package": "package",
  "kitn:cron": "crons",
};
