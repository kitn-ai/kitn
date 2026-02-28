import type { ComponentType } from "../registry/schema.js";

export const TYPE_ALIASES: Record<string, string> = {
  agent: "agent",
  agents: "agent",
  tool: "tool",
  tools: "tool",
  skill: "skill",
  skills: "skill",
  storage: "storage",
  storages: "storage",
  package: "package",
  packages: "package",
  cron: "cron",
  crons: "cron",
};

const SHORT_TO_COMPONENT: Record<string, ComponentType> = {
  agent: "kitn:agent",
  tool: "kitn:tool",
  skill: "kitn:skill",
  storage: "kitn:storage",
  package: "kitn:package",
  cron: "kitn:cron",
};

/** Resolve a user-provided type string (e.g. "agents") to its canonical short form (e.g. "agent"). */
export function resolveTypeAlias(input: string): string | undefined {
  return TYPE_ALIASES[input.toLowerCase()];
}

/** Convert a canonical short type (e.g. "agent") to a ComponentType (e.g. "kitn:agent"). */
export function toComponentType(shortType: string): ComponentType {
  const ct = SHORT_TO_COMPONENT[shortType];
  if (!ct) throw new Error(`Unknown component type: ${shortType}`);
  return ct;
}
