import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentEventBus } from "../events/agent-events.js";
import type { AgentRegistry } from "../types.js";

export interface DelegationContext {
  /** Ordered list of agent names in the current call chain */
  chain: string[];
  /** Current nesting depth (0 = top-level call) */
  depth: number;
  /** Shared event bus for the entire call tree */
  events?: AgentEventBus;
  /** Signal to abort all AI SDK calls in this request tree */
  abortSignal?: AbortSignal;
  /** Name of the orchestrator that initiated this request tree */
  orchestrator?: string;
}

/** Returns the set of orchestrator agent names (derived from registry at call time) */
export function getOrchestratorAgents(registry: AgentRegistry): Set<string> {
  return registry.getOrchestratorNames();
}

/** AsyncLocalStorage instance that propagates delegation context through async boundaries */
export const delegationStore = new AsyncLocalStorage<DelegationContext>();

/** Returns the event bus from the current delegation context, if any */
export function getEventBus(): AgentEventBus | undefined {
  return delegationStore.getStore()?.events;
}

/** Returns the abort signal from the current delegation context, if any */
export function getAbortSignal(): AbortSignal | undefined {
  return delegationStore.getStore()?.abortSignal;
}
