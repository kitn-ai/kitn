import type { LanguageModel } from "ai";
import type { AgentRegistry } from "./registry/agent-registry.js";
import type { ToolRegistry } from "./registry/tool-registry.js";
import type { StorageProvider } from "./storage/interfaces.js";
import type { VoiceManager } from "./voice/voice-manager.js";
import type { CardRegistry } from "./lib/card-registry.js";
import type { AIPluginConfig } from "./types.js";

/** Internal context passed to all route/lib factories */
export interface PluginContext {
  agents: AgentRegistry;
  tools: ToolRegistry;
  storage: StorageProvider;
  getModel: (id?: string) => LanguageModel;
  voice?: VoiceManager;
  cards: CardRegistry;
  maxDelegationDepth: number;
  defaultMaxSteps: number;
  config: AIPluginConfig;
}
