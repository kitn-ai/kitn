import type { Hono } from "hono";
import type {
  CoreConfig,
  PluginContext,
  AgentHandler,
  AgentRegistration,
  MemoryStore,
  OrchestratorAgentConfig,
  CronScheduler,
  LifecycleEventMap,
  LifecycleEventName,
  WildcardEvent,
} from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  voice?: VoiceConfig;
  memoryStore?: MemoryStore;
  cronScheduler?: CronScheduler;
}

export interface VoiceConfig {
  retainAudio?: boolean;
}

type EventHandler<T> = (data: T) => void | Promise<void>;

export interface AIPluginInstance extends PluginContext {
  router: Hono;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
  /** Subscribe to lifecycle hook events. Throws if hooks are not configured. */
  on<E extends LifecycleEventName>(event: E, handler: EventHandler<LifecycleEventMap[E]>): () => void;
  on(event: "*", handler: EventHandler<WildcardEvent>): () => void;
}
