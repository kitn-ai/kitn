import type { AgentRequest } from "../types.js";
import type { PromptStore } from "../storage/interfaces.js";
import type { z } from "zod";

export type AgentHandler = (
  req: AgentRequest,
  options: { systemPrompt: string; memoryContext?: string; body?: Record<string, any> },
) => Response | Promise<Response>;

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Context passed to agent guards by the framework.
 *
 * Adapters auto-populate this from the request body — if the client sends
 * `conversationId`, `hasHistory` is set to `true` automatically. Guards
 * that don't need context can ignore the third parameter (backward-compatible).
 *
 * @example
 * ```ts
 * guard: async (query, agent, context) => {
 *   // Skip guard on follow-up messages in an established conversation
 *   if (context?.hasHistory) return { allowed: true };
 *   // Run normal guard logic on first message
 *   if (isOffTopic(query)) return { allowed: false, reason: "Off-topic" };
 *   return { allowed: true };
 * }
 * ```
 */
export interface GuardContext {
  /** True when the request includes a conversationId (i.e. this is a follow-up, not the first message). */
  hasHistory: boolean;
  /** The conversation ID from the request body, if provided. */
  conversationId?: string;
  /** Number of messages in the conversation so far, if known. */
  messageCount?: number;
}

export interface ActionRegistration {
  name: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  summary: string;
  description: string;
  handler: (req: AgentRequest) => Response | Promise<Response>;
  requestSchema?: z.ZodType<any>;
}

export interface AgentRegistration {
  name: string;
  description: string;
  tags?: string[];
  toolNames: string[];
  defaultFormat: "json" | "sse";
  defaultSystem: string;
  tools?: Record<string, any>;
  jsonHandler?: AgentHandler;
  sseHandler?: AgentHandler;
  actions?: ActionRegistration[];
  /** Explicit list of agent names this orchestrator routes to (omit for auto-discovery) */
  agents?: string[];
  /** Marks agent as an orchestrator — orchestrators cannot be delegated to */
  isOrchestrator?: boolean;
  /** Disable the built-in _memory tool for this agent (default: false) */
  disableMemoryTool?: boolean;
  /**
   * Pre-execution guard. Called with the user's query before the agent runs.
   * Return `{ allowed: false, reason }` to block execution (HTTP 403).
   *
   * The optional `context` parameter is populated automatically by the framework's
   * HTTP adapters. When the client sends a `conversationId` in the request body,
   * `context.hasHistory` is `true` — use this to skip the guard on follow-up
   * messages in an established conversation.
   *
   * @param query - The user's message
   * @param agent - The agent name being invoked
   * @param context - Conversation context (auto-populated by adapters)
   */
  guard?: (query: string, agent: string, context?: GuardContext) => GuardResult | Promise<GuardResult>;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();
  private promptOverrides = new Map<string, string>();
  private overridesLoaded = false;
  private promptStore?: PromptStore;

  register(registration: AgentRegistration) {
    this.agents.set(registration.name, registration);
  }

  get(name: string): AgentRegistration | undefined {
    return this.agents.get(name);
  }

  list(): AgentRegistration[] {
    return [...this.agents.values()];
  }

  setPromptStore(store: PromptStore) {
    this.promptStore = store;
  }

  private async ensureOverridesLoaded(): Promise<void> {
    if (this.overridesLoaded || !this.promptStore) return;
    this.overridesLoaded = true;
    try {
      const overrides = await this.promptStore.loadOverrides();
      for (const [name, entry] of Object.entries(overrides)) {
        this.promptOverrides.set(name, entry.prompt);
      }
    } catch { /* storage unavailable — use defaults */ }
  }

  async getResolvedPrompt(name: string): Promise<string | undefined> {
    const agent = this.agents.get(name);
    if (!agent) return undefined;
    await this.ensureOverridesLoaded();
    return this.promptOverrides.get(name) ?? agent.defaultSystem;
  }

  setPromptOverride(name: string, prompt: string) {
    this.promptOverrides.set(name, prompt);
  }

  resetPrompt(name: string) {
    this.promptOverrides.delete(name);
  }

  async hasPromptOverride(name: string): Promise<boolean> {
    await this.ensureOverridesLoaded();
    return this.promptOverrides.has(name);
  }

  /** Returns the set of agent names that are marked as orchestrators */
  getOrchestratorNames(): Set<string> {
    const names = new Set<string>();
    for (const agent of this.agents.values()) {
      if (agent.isOrchestrator) names.add(agent.name);
    }
    return names;
  }
}
