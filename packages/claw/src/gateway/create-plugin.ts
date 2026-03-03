import {
  AgentRegistry,
  ToolRegistry,
  CardRegistry,
  createMemoryStorage,
  type PluginContext,
} from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { createModelFactory } from "./model-factory.js";

/**
 * Create a @kitnai/core PluginContext for KitnClaw.
 *
 * This is the central context that holds all registries, storage,
 * and the model factory. Everything in KitnClaw flows through this.
 */
export function createClawPlugin(config: ClawConfig): PluginContext {
  const model = createModelFactory(config);

  // TODO: Replace with libSQL-backed storage in Phase 3
  const storage = createMemoryStorage();

  return {
    agents: new AgentRegistry(),
    tools: new ToolRegistry(),
    cards: new CardRegistry(),
    storage,
    model,
    maxDelegationDepth: 3,
    defaultMaxSteps: 10,
    config: { model, storage },
  };
}
