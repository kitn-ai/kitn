import { z } from "zod";

export const componentType = z.enum(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:storage"]);
export type ComponentType = z.infer<typeof componentType>;

export const registryFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  type: componentType,
});

export const registryItemSchema = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  type: componentType,
  description: z.string(),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  files: z.array(registryFileSchema),
  docs: z.string().optional(),
  categories: z.array(z.string()).optional(),
  version: z.string().optional(),
});
export type RegistryItem = z.infer<typeof registryItemSchema>;

export const registryIndexItemSchema = z.object({
  name: z.string(),
  type: componentType,
  description: z.string(),
  registryDependencies: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  version: z.string().optional(),
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
};
