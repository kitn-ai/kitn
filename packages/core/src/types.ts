import type { LanguageModel } from "ai";
import type { AgentRegistry } from "./registry/agent-registry.js";
export type { AgentRegistry };
import type { ToolRegistry } from "./registry/tool-registry.js";
import type { StorageProvider } from "./storage/interfaces.js";
import type { VoiceManager } from "./voice/voice-manager.js";
import type { CardRegistry } from "./utils/card-registry.js";
import type { CronScheduler } from "./crons/scheduler.js";
import type { LifecycleHookConfig, LifecycleHookEmitter } from "./hooks/lifecycle-hooks.js";

/**
 * Framework-agnostic request interface.
 * Adapters (Hono, Express, etc.) convert their native request objects
 * into this shape before calling core handlers.
 */
export interface AgentRequest {
  json<T = unknown>(): Promise<T>;
  query(key: string): string | undefined;
  param(key: string): string;
  header(key: string): string | undefined;
  /** The raw Web API Request (for access to .signal, etc.) */
  raw: Request;
}

export interface ResilienceConfig {
  /** Max retry attempts before invoking fallback (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 to randomize delay (default: 0.2) */
  jitterFactor?: number;
  /** Fallback interceptor. Return a new model ID to retry, or null to abort. */
  onFallback?: (context: FallbackContext) => string | null | Promise<string | null>;
}

export interface FallbackContext {
  agent?: string;
  currentModel: string;
  retryCount: number;
  error: Error;
}

export interface CompactionConfig {
  /** Auto-compact when message count exceeds threshold (default: 20) */
  threshold?: number;
  /** Number of recent messages to preserve (default: 4) */
  preserveRecent?: number;
  /** Custom system prompt for summarization LLM call */
  prompt?: string;
  /** Model to use for compaction (defaults to plugin default) */
  model?: string;
  /** Enable/disable auto-compaction (default: true when config provided) */
  enabled?: boolean;
}

/** Core configuration — framework-agnostic. */
export interface CoreConfig {
  /** Returns a LanguageModel for the given model ID (or default). Optional — only needed for agent chat. */
  model?: (model?: string) => LanguageModel;
  /** Storage provider. Defaults to in-memory (ephemeral) if omitted. */
  storage?: StorageProvider;
  /** Maximum delegation nesting depth (default: 3) */
  maxDelegationDepth?: number;
  /** Default max AI SDK steps per agent call (default: 5) */
  defaultMaxSteps?: number;
  /** Resilience configuration for LLM call retries and fallback */
  resilience?: ResilienceConfig;
  /** Conversation compaction configuration */
  compaction?: CompactionConfig;
  /** Lifecycle hooks configuration. When set, enables execution event emission. */
  hooks?: LifecycleHookConfig;
  /** Platform-specific waitUntil for serverless background execution. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Internal context passed to all core handlers and factories. */
export interface PluginContext {
  agents: AgentRegistry;
  tools: ToolRegistry;
  storage: StorageProvider;
  model: (model?: string) => LanguageModel;
  voice?: VoiceManager;
  cards: CardRegistry;
  maxDelegationDepth: number;
  defaultMaxSteps: number;
  config: CoreConfig;
  cronScheduler?: CronScheduler;
  /** Lifecycle hook emitter for observability events. Present when hooks config is provided. */
  hooks?: LifecycleHookEmitter;
}

