import {
  AgentRegistry,
  ToolRegistry,
  CardRegistry,
  createMemoryStorage,
  type PluginContext,
} from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { createModelFactory } from "./model-factory.js";
import { JsonlSessionStore } from "../sessions/store.js";
import { LibsqlMemoryStore } from "../memory/store.js";
import { CLAW_HOME } from "../config/io.js";
import { join } from "path";

/**
 * Create a @kitnai/core PluginContext for KitnClaw.
 *
 * This is the central context that holds all registries, storage,
 * and the model factory. Everything in KitnClaw flows through this.
 */
export function createClawPlugin(config: ClawConfig): PluginContext {
  const model = createModelFactory(config);

  // Start with in-memory storage for sub-stores we haven't replaced yet
  const baseStorage = createMemoryStorage();

  // Replace conversations with JSONL session store
  const sessionsDir = join(CLAW_HOME, "sessions");
  const conversations = new JsonlSessionStore(sessionsDir);

  // Replace memory with libSQL-backed store
  const dbPath = join(CLAW_HOME, "memory.db");
  const memory = new LibsqlMemoryStore(dbPath);

  const storage = {
    ...baseStorage,
    conversations,
    memory,
  };

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
