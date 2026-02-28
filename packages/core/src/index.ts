// ── Core types ──
export type { AgentRequest, CoreConfig, PluginContext, ResilienceConfig, FallbackContext, CompactionConfig } from "./types.js";

// ── Registry ──
export { AgentRegistry } from "./registry/agent-registry.js";
export { ToolRegistry } from "./registry/tool-registry.js";
export { makeRegistryHandlers, makeRegistryStreamHandler, makeRegistryJsonHandler, generateConversationId } from "./registry/handler-factories.js";
export {
  registerAgent, registerTool, registerCommand, registerSkill,
  registerWithPlugin,
} from "./registry/self-register.js";
export type {
  AgentSelfRegConfig, ToolSelfRegConfig, CommandSelfRegConfig, SkillSelfRegConfig,
} from "./registry/self-register.js";
export type { AgentRegistration, AgentHandler, ActionRegistration, GuardResult } from "./registry/agent-registry.js";
export type { ToolRegistration } from "./registry/tool-registry.js";

// ── Agent utilities ──
export { createOrchestratorAgent, DEFAULT_ORCHESTRATOR_PROMPT } from "./agents/orchestrator.js";
export type { OrchestratorAgentConfig } from "./agents/orchestrator.js";
export { executeTask } from "./agents/execute-task.js";
export type { TaskResult, ClarifyItem } from "./agents/execute-task.js";
export { createMemoryTool, getDefaultMemoryStore, setDefaultMemoryStore } from "./agents/memory-tool.js";
export { runAgent } from "./agents/run-agent.js";

// ── Events ──
export { AgentEventBus } from "./events/agent-events.js";
export type { AgentEvent } from "./events/agent-events.js";
export { SSE_EVENTS, BUS_EVENTS, BUS_TO_SSE_MAP, FORWARDED_BUS_EVENTS, STATUS_CODES } from "./events/events.js";
export type { SseEventName, BusEventName, StatusCode } from "./events/events.js";
export { emitStatus, writeStatus } from "./events/emit-status.js";
export type { StatusPayload } from "./events/emit-status.js";

// ── Constants ──
export { TOOL_NAMES, DEFAULTS } from "./utils/constants.js";

// ── Card registry ──
export { CardRegistry } from "./utils/card-registry.js";
export type { CardData, CardExtractor } from "./utils/card-registry.js";

// ── AI provider utilities ──
export type { UsageInfo } from "./utils/ai-provider.js";
export { extractUsage, extractStreamUsage, mergeUsage } from "./utils/ai-provider.js";

// ── Delegation context ──
export { delegationStore, getEventBus, getAbortSignal } from "./utils/delegation-context.js";
export type { DelegationContext } from "./utils/delegation-context.js";

// ── Request registry ──
export { registerRequest, cancelRequest, unregisterRequest } from "./utils/request-registry.js";

// ── Streaming ──
export { streamAgentResponse } from "./streaming/stream-helpers.js";
export { createSSEStream } from "./streaming/sse-writer.js";
export type { SSEWriter, SSEMessage } from "./streaming/sse-writer.js";

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
  CommandRegistration,
  CommandStore,
  CronJob,
  CronExecution,
  CronStore,
} from "./storage/interfaces.js";
export { createFileStorage } from "./storage/file-storage/index.js";
export type { FileStorageOptions } from "./storage/file-storage/index.js";
export { createMemoryStorage } from "./storage/in-memory/index.js";
export { createInMemoryMemoryStore } from "./storage/in-memory/memory-store.js";

// ── Tool examples ──
export type { ToolExample } from "./utils/tool-examples.js";
export { formatExamplesBlock, buildToolDescription } from "./utils/tool-examples.js";

// ── Voice ──
export type { VoiceProvider, TranscribeOptions, TranscribeResult, SpeakOptions, VoiceSpeaker } from "./voice/voice-provider.js";
export { VoiceManager } from "./voice/voice-manager.js";
export { OpenAIVoiceProvider } from "./voice/openai-voice-provider.js";
export type { OpenAIVoiceProviderConfig } from "./voice/openai-voice-provider.js";

// ── Resilience ──
export { withResilience, isRetryableError } from "./utils/resilience.js";

// ── Compaction ──
export { compactConversation, needsCompaction, COMPACTION_METADATA_KEY } from "./utils/compaction.js";
export type { CompactionResult } from "./utils/compaction.js";

// ── Conversation helpers ──
export { loadConversationWithCompaction } from "./utils/conversation-helpers.js";

// ── Crons ──
export { getNextRun, validateCron } from "./crons/index.js";
export { executeCronJob } from "./crons/index.js";
export type { CronScheduler } from "./crons/index.js";

// ── Schemas ──
import "./schemas/setup-openapi.js";
export { generateRequestSchema, generateResponseSchema } from "./schemas/generate.schemas.js";
export { agentRequestSchema, agentResponseSchema, approveRequestSchema, agentPatchSchema } from "./schemas/agents.schemas.js";
export { memoryEntrySchema, memorySaveSchema } from "./schemas/memory.schemas.js";
export { skillMetaSchema, skillSchema, skillCreateSchema, skillUpdateSchema } from "./schemas/skills.schemas.js";
export { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema, converseResponseHeadersSchema } from "./schemas/voice.schemas.js";
