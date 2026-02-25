// ── Main factory ──
export { createAIPlugin } from "./plugin.js";
export type { AIPluginConfig, AIPluginInstance, VoiceConfig, ResilienceConfig, FallbackContext, CompactionConfig } from "./types.js";
export type { PluginContext } from "./context.js";

// ── Registry types (consumers register their agents/tools) ──
export { AgentRegistry, ToolRegistry } from "./registry/index.js";
export { makeRegistryHandlers, makeRegistryStreamHandler, makeRegistryJsonHandler, generateConversationId } from "./registry/index.js";
export type { AgentRegistration, ToolRegistration, AgentHandler, ActionRegistration, GuardResult } from "./registry/index.js";

// ── Agent utilities ──
export { createOrchestratorAgent, DEFAULT_ORCHESTRATOR_PROMPT } from "./agents/orchestrator.js";
export type { OrchestratorAgentConfig } from "./agents/orchestrator.js";
export { executeTask } from "./agents/execute-task.js";
export type { TaskResult, ClarifyItem } from "./agents/execute-task.js";
export { createMemoryTool, getDefaultMemoryStore, setDefaultMemoryStore } from "./agents/memory-tool.js";
export { AgentEventBus } from "./lib/agent-events.js";
export type { AgentEvent } from "./lib/agent-events.js";

// ── Event & tool constants ──
export { SSE_EVENTS, BUS_EVENTS, BUS_TO_SSE_MAP, FORWARDED_BUS_EVENTS, STATUS_CODES } from "./lib/events.js";
export type { SseEventName, BusEventName, StatusCode } from "./lib/events.js";

// ── Status helpers ──
export { emitStatus, writeStatus } from "./lib/emit-status.js";
export type { StatusPayload } from "./lib/emit-status.js";
export { TOOL_NAMES, DEFAULTS } from "./lib/constants.js";

// ── Card registry ──
export { CardRegistry } from "./lib/card-registry.js";
export type { CardData, CardExtractor } from "./lib/card-registry.js";

// ── AI provider utilities ──
export type { UsageInfo } from "./lib/ai-provider.js";
export { extractUsage, extractStreamUsage, mergeUsage } from "./lib/ai-provider.js";

// ── Delegation context ──
export { delegationStore, getEventBus, getAbortSignal } from "./lib/delegation-context.js";
export type { DelegationContext } from "./lib/delegation-context.js";

// ── Request registry ──
export { registerRequest, cancelRequest, unregisterRequest } from "./lib/request-registry.js";

// ── Streaming ──
export { streamAgentResponse } from "./lib/stream-helpers.js";
export { runAgent } from "./lib/run-agent.js";

// ── Storage ──
export type {
  StorageProvider,
  ConversationStore,
  ConversationMessage,
  Conversation,
  ConversationSummary,
  MemoryStore,
  MemoryEntry,
  SkillStore,
  SkillMeta,
  Skill,
  SkillPhase,
  TaskStore,
  Task,
  PromptStore,
  PromptOverride,
  AudioStore,
  AudioEntry,
} from "./storage/interfaces.js";
export { createFileStorage } from "./storage/file-storage/index.js";
export type { FileStorageOptions } from "./storage/file-storage/index.js";
export { createMemoryStorage } from "./storage/in-memory/index.js";
export { createInMemoryMemoryStore } from "./storage/in-memory/memory-store.js";

// ── Tool examples ──
export type { ToolExample } from "./lib/tool-examples.js";
export { formatExamplesBlock, buildToolDescription } from "./lib/tool-examples.js";

// ── Voice (optional) ──
export type { VoiceProvider, TranscribeOptions, TranscribeResult, SpeakOptions, VoiceSpeaker } from "./voice/voice-provider.js";
export { VoiceManager } from "./voice/voice-manager.js";
export { OpenAIVoiceProvider } from "./voice/openai-voice-provider.js";
export type { OpenAIVoiceProviderConfig } from "./voice/openai-voice-provider.js";

// ── Resilience ──
export { withResilience, isRetryableError } from "./lib/resilience.js";

// ── Compaction ──
export { compactConversation, needsCompaction, COMPACTION_METADATA_KEY } from "./lib/compaction.js";
export type { CompactionResult } from "./lib/compaction.js";

// ── Conversation helpers ──
export { loadConversationWithCompaction } from "./lib/conversation-helpers.js";

// ── Auth utility ──
export { createApiKeyAuth } from "./lib/auth.js";
