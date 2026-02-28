import type { Elysia } from "elysia";
import type {
  CoreConfig,
  PluginContext,
  AgentHandler,
  AgentRegistration,
  MemoryStore,
  OrchestratorAgentConfig,
  CronScheduler,
} from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  voice?: VoiceConfig;
  memoryStore?: MemoryStore;
  cronScheduler?: CronScheduler;
}

export interface VoiceConfig {
  retainAudio?: boolean;
}

export interface AIPluginInstance extends PluginContext {
  router: Elysia;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
}
