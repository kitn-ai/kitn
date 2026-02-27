import { z } from "zod";

// Component types
export const componentType = z.enum([
  "kitn:agent",
  "kitn:tool",
  "kitn:skill",
  "kitn:storage",
  "kitn:package",
]);
export type ComponentType = z.infer<typeof componentType>;

// A single file within a registry item
export const registryFileSchema = z.object({
  path: z.string().describe("Relative path within the component type directory"),
  content: z.string().describe("Full source code of the file"),
  type: componentType,
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

// Changelog entry
export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  type: z.enum(["feature", "fix", "breaking", "initial"]),
  note: z.string(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

// Full registry item (fetched on demand, includes file content)
export const registryItemSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().describe("Unique component identifier"),
  type: componentType,
  description: z.string(),
  dependencies: z.array(z.string()).optional().describe("npm package dependencies"),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional().describe("Other kitn components this depends on"),
  envVars: z.record(z.string(), z.object({
    description: z.string(),
    required: z.boolean().optional(),
    secret: z.boolean().optional(),
    url: z.string().optional(),
  })).optional().describe("Required env vars with rich config"),
  files: z.array(registryFileSchema),
  installDir: z.string().optional().describe("Target directory for package installation"),
  tsconfig: z.record(z.string(), z.array(z.string())).optional().describe("TSConfig path aliases to add"),
  docs: z.string().optional().describe("Post-install instructions shown in terminal"),
  categories: z.array(z.string()).optional(),
  slot: z.string().optional().describe("Exclusive slot — components sharing a slot value conflict at install time"),
  version: z.string().optional().default("1.0.0"),
  updatedAt: z.string().optional(),
  changelog: z.array(changelogEntrySchema).optional(),
});
export type RegistryItem = z.infer<typeof registryItemSchema>;

// Registry index item (metadata only, no file content)
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
export type RegistryIndexItem = z.infer<typeof registryIndexItemSchema>;

// Full registry index
export const registryIndexSchema = z.object({
  $schema: z.string().optional(),
  version: z.string(),
  items: z.array(registryIndexItemSchema),
});
export type RegistryIndex = z.infer<typeof registryIndexSchema>;

// Installed component tracking
export const installedComponentSchema = z.object({
  registry: z.string().optional(),
  type: componentType,
  slot: z.string().optional(),
  version: z.string(),
  installedAt: z.string(),
  files: z.array(z.string()),
  hash: z.string(),
  registryDependencies: z.array(z.string()).optional(),
});
export type InstalledComponent = z.infer<typeof installedComponentSchema>;

// Runtime type
export const runtimeType = z.enum(["bun", "node", "deno"]);

// Framework type
export const frameworkType = z.enum(["hono", "cloudflare", "elysia", "fastify", "express"]);

// kitn.json config
export const configSchema = z.object({
  $schema: z.string().optional(),
  runtime: runtimeType,
  framework: frameworkType.optional(),
  aliases: z.object({
    base: z.string().optional(),
    agents: z.string(),
    tools: z.string(),
    skills: z.string(),
    storage: z.string(),
  }),
  registries: z.record(z.string(), z.string()),
  installed: z.record(z.string(), installedComponentSchema).optional(),
});
export type KitnConfig = z.infer<typeof configSchema>;

// Map component type to alias key (excludes kitn:package which uses installDir)
export const typeToAliasKey: Partial<Record<ComponentType, keyof KitnConfig["aliases"]>> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
};
