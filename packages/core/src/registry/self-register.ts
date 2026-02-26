import type { z } from "zod";
import type { PluginContext } from "../types.js";
import { makeRegistryHandlers } from "./handler-factories.js";

// ── Config types ──

export interface AgentSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools: Record<string, any>;
  format?: "json" | "sse";
}

export interface ToolSelfRegConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
}

export interface CommandSelfRegConfig {
  name: string;
  description: string;
  system: string;
  tools?: string[];
  model?: string;
  format?: "json" | "sse";
}

export interface SkillSelfRegConfig {
  name: string;
  description: string;
}

// ── Module-level stores ──

const agentConfigs = new Map<string, AgentSelfRegConfig>();
const toolConfigs = new Map<string, ToolSelfRegConfig>();
const commandConfigs = new Map<string, CommandSelfRegConfig>();
const skillConfigs = new Map<string, SkillSelfRegConfig>();

// ── Registration functions (called at module load time) ──

export function registerAgent(config: AgentSelfRegConfig): void {
  agentConfigs.set(config.name, config);
}

export function registerTool(config: ToolSelfRegConfig): void {
  toolConfigs.set(config.name, config);
}

export function registerCommand(config: CommandSelfRegConfig): void {
  commandConfigs.set(config.name, config);
}

export function registerSkill(config: SkillSelfRegConfig): void {
  skillConfigs.set(config.name, config);
}

// ── Flush function ──

/**
 * Flush all collected registrations into the plugin context.
 *
 * Call this once after creating the plugin to wire up all self-registered
 * agents, tools, commands, and skills.
 *
 * 1. Tools are registered first (agents may reference them)
 * 2. Agents are registered with auto-created handlers
 * 3. Commands are saved to storage (when CommandStore is available)
 * 4. All maps are cleared after flush (idempotent)
 */
export function registerWithPlugin(ctx: PluginContext): void {
  // 1. Register tools first
  for (const config of toolConfigs.values()) {
    ctx.tools.register({
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
      tool: config.tool,
      directExecute: config.directExecute,
      category: config.category,
    });
  }

  // 2. Register agents with auto-created handlers
  for (const config of agentConfigs.values()) {
    const format = config.format ?? "sse";
    const { sseHandler, jsonHandler } = makeRegistryHandlers(
      { tools: config.tools },
      ctx,
    );

    ctx.agents.register({
      name: config.name,
      description: config.description,
      defaultSystem: config.system,
      defaultFormat: format,
      toolNames: Object.keys(config.tools),
      tools: config.tools,
      sseHandler,
      jsonHandler,
    });
  }

  // 3. Save commands to storage (CommandStore may not exist yet)
  for (const config of commandConfigs.values()) {
    (ctx.storage as any).commands?.save(config);
  }

  // 4. Clear all maps (idempotent)
  agentConfigs.clear();
  toolConfigs.clear();
  commandConfigs.clear();
  skillConfigs.clear();
}

// ── Test helper ──

/** @internal Clear all maps for test isolation. */
export function _resetForTesting(): void {
  agentConfigs.clear();
  toolConfigs.clear();
  commandConfigs.clear();
  skillConfigs.clear();
}
