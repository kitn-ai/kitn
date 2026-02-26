import type { OpenAPIHono } from "@hono/zod-openapi";
import type {
  CoreConfig,
  AgentRegistry,
  ToolRegistry,
  AgentHandler,
  AgentRegistration,
  CardRegistry,
  VoiceManager,
  StorageProvider,
  MemoryStore,
  OrchestratorAgentConfig,
} from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  voice?: VoiceConfig;
  memoryStore?: MemoryStore;
  openapi?: { title?: string; version?: string; description?: string; serverUrl?: string };
}

export interface VoiceConfig {
  retainAudio?: boolean;
}

export interface AIPluginInstance {
  app: OpenAPIHono;
  agents: AgentRegistry;
  tools: ToolRegistry;
  cards: CardRegistry;
  voice?: VoiceManager;
  initialize(): Promise<void>;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
}
