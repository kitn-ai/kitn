// Re-export everything from core for backwards compatibility
export * from "@kitnai/core";

// Hono-specific exports
export { createAIPlugin } from "./plugin.js";
export type { AIPluginConfig, AIPluginInstance } from "./types.js";
export { toAgentRequest } from "./adapters/request-adapter.js";
