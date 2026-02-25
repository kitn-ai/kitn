import type { AgentRequest } from "../types.js";
import type { z } from "zod";

export type AgentHandler = (
  req: AgentRequest,
  options: { systemPrompt: string; memoryContext?: string },
) => Response | Promise<Response>;

export interface GuardResult {
  allowed: boolean;
  reason?: string;
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
  /** Pre-execution guard. Called with the query before the agent runs.
   *  Return { allowed: false, reason } to block execution. */
  guard?: (query: string, agent: string) => GuardResult | Promise<GuardResult>;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();
  private promptOverrides = new Map<string, string>();

  register(registration: AgentRegistration) {
    this.agents.set(registration.name, registration);
  }

  get(name: string): AgentRegistration | undefined {
    return this.agents.get(name);
  }

  list(): AgentRegistration[] {
    return [...this.agents.values()];
  }

  getResolvedPrompt(name: string): string | undefined {
    const agent = this.agents.get(name);
    if (!agent) return undefined;
    return this.promptOverrides.get(name) ?? agent.defaultSystem;
  }

  setPromptOverride(name: string, prompt: string) {
    this.promptOverrides.set(name, prompt);
  }

  resetPrompt(name: string) {
    this.promptOverrides.delete(name);
  }

  hasPromptOverride(name: string): boolean {
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

  loadPromptOverrides(overrides: Record<string, string>) {
    for (const [name, prompt] of Object.entries(overrides)) {
      this.promptOverrides.set(name, prompt);
    }
  }
}
