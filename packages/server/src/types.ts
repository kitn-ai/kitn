import type { LanguageModel } from "ai";
import type { MiddlewareHandler } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AgentRegistry, AgentHandler, AgentRegistration } from "./registry/agent-registry.js";
import type { ToolRegistry } from "./registry/tool-registry.js";
import type { VoiceManager } from "./voice/voice-manager.js";
import type { CardRegistry } from "./lib/card-registry.js";
import type { StorageProvider, MemoryStore } from "./storage/interfaces.js";
import type { OrchestratorAgentConfig } from "./agents/orchestrator.js";

export interface AIPluginConfig {
  /** Returns a LanguageModel for the given model ID (or default) */
  getModel: (id?: string) => LanguageModel;
  /** Storage provider. Defaults to in-memory (ephemeral) if omitted.
   *  Use createFileStorage() for disk persistence or provide your own. */
  storage?: StorageProvider;
  /** Optional auth middleware applied to all routes */
  authMiddleware?: MiddlewareHandler;
  /** Voice configuration (omit to disable voice routes) */
  voice?: VoiceConfig;
  /** Maximum delegation nesting depth (default: 3) */
  maxDelegationDepth?: number;
  /** Default max AI SDK steps per agent call (default: 5) */
  defaultMaxSteps?: number;
  /** Override the in-memory store used by the built-in _memory tool.
   *  Defaults to an ephemeral Map-based store. */
  memoryStore?: MemoryStore;
  /** Resilience configuration for LLM call retries and fallback */
  resilience?: ResilienceConfig;
  /** Conversation compaction configuration */
  compaction?: CompactionConfig;
  /** OpenAPI doc metadata */
  openapi?: {
    title?: string;
    version?: string;
    description?: string;
    serverUrl?: string;
  };
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

export interface VoiceConfig {
  /** Whether to retain audio files server-side */
  retainAudio?: boolean;
}

export interface AIPluginInstance {
  /** The Hono sub-app to mount with app.route("/ai", plugin.app) */
  app: OpenAPIHono;
  /** Agent registry — register your agents here */
  agents: AgentRegistry;
  /** Tool registry — register your tools here */
  tools: ToolRegistry;
  /** Card extractor registry — register UI card extractors here */
  cards: CardRegistry;
  /** Voice manager (undefined if voice not configured) */
  voice?: VoiceManager;
  /** Load prompt overrides and finalize setup */
  initialize(): Promise<void>;
  /** Create SSE + JSON handler pair for a set of tools (used when registering agents) */
  createHandlers(config: { tools: Record<string, any>; maxSteps?: number }): {
    sseHandler: AgentHandler;
    jsonHandler: AgentHandler;
  };
  /** Create and register an orchestrator agent */
  createOrchestrator(config: OrchestratorAgentConfig): AgentRegistration;
}
