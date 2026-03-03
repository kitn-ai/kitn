import { z } from "zod";

const providerSchema = z.object({
  type: z.enum(["openrouter", "openai", "anthropic", "google", "ollama", "custom"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const terminalChannelSchema = z.object({
  enabled: z.boolean().default(true),
}).default({ enabled: true });

const discordChannelSchema = z.object({
  token: z.string(),
  enabled: z.boolean().default(true),
});

const telegramChannelSchema = z.object({
  token: z.string(),
  enabled: z.boolean().default(true),
});

const whatsappChannelSchema = z.object({
  enabled: z.boolean().default(true),
});

const channelsSchema = z.object({
  terminal: terminalChannelSchema.optional(),
  discord: discordChannelSchema.optional(),
  telegram: telegramChannelSchema.optional(),
  whatsapp: whatsappChannelSchema.optional(),
}).default({ terminal: { enabled: true } });

const toolRuleSchema = z.object({
  allowPatterns: z.array(z.string()).optional(),
  allowPaths: z.array(z.string()).optional(),
  denyPatterns: z.array(z.string()).optional(),
  denyPaths: z.array(z.string()).optional(),
});

const channelOverrideSchema = z.object({
  denied: z.array(z.string()).optional(),
});

const rateLimitsSchema = z.object({
  maxPerMinute: z.number(),
  toolLimits: z.record(z.string(), z.number()).optional(),
});

const permissionsSchema = z.object({
  profile: z.enum(["cautious", "balanced", "autonomous"]).default("balanced"),
  sandbox: z.string().default(""),
  grantedDirs: z.array(z.string()).default([]),
  denied: z.array(z.string()).default([]),
  rules: z.record(z.string(), toolRuleSchema).optional(),
  channelOverrides: z.record(z.string(), channelOverrideSchema).optional(),
  rateLimits: rateLimitsSchema.optional(),
}).default({ profile: "balanced", sandbox: "", grantedDirs: [], denied: [] });

const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

const gatewaySchema = z.object({
  port: z.number().default(18800),
  bind: z.enum(["loopback", "lan"]).default("loopback"),
}).default({ port: 18800, bind: "loopback" as const });

export const configSchema = z.object({
  provider: providerSchema.optional(),
  model: z.string().default("openai/gpt-4o-mini"),
  channels: channelsSchema,
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
  permissions: permissionsSchema,
  registries: z.record(z.string(), z.string()).default({
    "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json",
  }),
  gateway: gatewaySchema,
});

export type ClawConfig = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): ClawConfig {
  return configSchema.parse(raw);
}
