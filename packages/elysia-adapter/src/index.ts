// Re-export everything from core
export * from "@kitnai/core";

// Elysia-specific exports
export { createAIPlugin } from "./plugin.js";
export type { AIPluginConfig, AIPluginInstance, VoiceConfig } from "./types.js";
export { toAgentRequest } from "./adapters/request-adapter.js";
