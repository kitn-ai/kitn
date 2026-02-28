import type { OpenAPIHono } from "@hono/zod-openapi";
import type {
  CoreConfig,
  PluginContext,
  AgentRegistry,
  ToolRegistry,
  AgentHandler,
  AgentRegistration,
  CardRegistry,
  StorageProvider,
  MemoryStore,
  OrchestratorAgentConfig,
  CronScheduler,
  EventBuffer,
  KitnPlugin,
  LifecycleEventMap,
  LifecycleEventName,
  WildcardEvent,
} from "@kitnai/core";

export interface AIPluginConfig extends CoreConfig {
  memoryStore?: MemoryStore;
  cronScheduler?: CronScheduler;
  openapi?: { title?: string; version?: string; description?: string; serverUrl?: string };
}

type EventHandler<T> = (data: T) => void | Promise<void>;

export interface AIPluginInstance extends PluginContext {
  router: OpenAPIHono;
  /** Shared event buffer for reconnectable job SSE streaming. Always present. */
  eventBuffer: EventBuffer;
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
  /** Subscribe to lifecycle hook events. Throws if hooks are not configured. */
  on<E extends LifecycleEventName>(event: E, handler: EventHandler<LifecycleEventMap[E]>): () => void;
  on(event: "*", handler: EventHandler<WildcardEvent>): () => void;
}
