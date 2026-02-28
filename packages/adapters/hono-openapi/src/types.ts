import type { OpenAPIHono } from "@hono/zod-openapi";
import type {
  CoreConfig,
  PluginContext,
  AgentRegistry,
  ToolRegistry,
  AgentHandler,
  AgentRegistration,
  CardRegistry,
  VoiceManager,
  StorageProvider,
  MemoryStore,
  OrchestratorAgentConfig,
  CronScheduler,
} from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  voice?: VoiceConfig;
  memoryStore?: MemoryStore;
  cronScheduler?: CronScheduler;
  openapi?: { title?: string; version?: string; description?: string; serverUrl?: string };
}

export interface VoiceConfig {
  retainAudio?: boolean;
}

export interface AIPluginInstance extends PluginContext {
  router: OpenAPIHono;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
}
