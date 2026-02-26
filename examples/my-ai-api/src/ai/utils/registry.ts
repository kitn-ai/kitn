import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono";

// Collected configs — components self-register into these on import
const toolConfigs = new Map<string, ToolConfig>();
const agentConfigs = new Map<string, AgentConfig>();

interface ToolConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  tool: any;
  directExecute?: (input: any) => Promise<any>;
  category?: string;
}

interface AgentConfig {
  name: string;
  description: string;
  system: string;
  tools: Record<string, any>;
  format?: "sse" | "json";
}

// Called by tool files at module level
export function registerTool(config: ToolConfig) {
  toolConfigs.set(config.name, config);
}

// Called by agent files at module level
export function registerAgent(config: AgentConfig) {
  agentConfigs.set(config.name, config);
}

// Called once in app.ts after plugin is created — flushes all collected configs
export function registerWithPlugin(plugin: AIPluginInstance) {
  for (const config of toolConfigs.values()) {
    plugin.tools.register(config);
  }

  for (const config of agentConfigs.values()) {
    const { sseHandler, jsonHandler } = plugin.createHandlers({
      tools: config.tools,
    });

    plugin.agents.register({
      name: config.name,
      description: config.description,
      toolNames: Object.keys(config.tools),
      defaultFormat: config.format ?? "sse",
      defaultSystem: config.system,
      tools: config.tools,
      sseHandler,
      jsonHandler,
    });
  }
}
