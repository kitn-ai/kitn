// ── Shared field types ──

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Fields present on agent-scoped events */
interface AgentScopeFields {
  agentName: string;
  conversationId: string;
  scopeId?: string;
  jobId?: string;
  timestamp: number;
}

// ── Summary-level events (always emitted) ──

export interface AgentStartEvent extends AgentScopeFields {
  input: string;
}

export interface AgentEndEvent extends AgentScopeFields {
  input: string;
  output: string;
  toolsUsed: string[];
  usage: TokenUsage;
  duration: number;
}

export interface AgentErrorEvent extends AgentScopeFields {
  input: string;
  error: unknown;
  duration: number;
}

export interface JobStartEvent {
  jobId: string;
  agentName: string;
  input: string;
  conversationId: string;
  scopeId?: string;
  timestamp: number;
}

export interface JobEndEvent {
  jobId: string;
  agentName: string;
  output: string;
  duration: number;
  usage: TokenUsage;
  timestamp: number;
}

export interface JobCancelledEvent {
  jobId: string;
  agentName: string;
  duration: number;
  timestamp: number;
}

export interface CronExecutedEvent {
  cronId: string;
  agentName: string;
  executionId: string;
  status: "completed" | "failed";
  duration: number;
  timestamp: number;
}

// ── Trace-level events (only when level is "trace") ──

export interface ToolExecuteEvent {
  agentName: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  duration: number;
  conversationId: string;
  timestamp: number;
}

export interface DelegateStartEvent {
  parentAgent: string;
  childAgent: string;
  input: string;
  conversationId: string;
  timestamp: number;
}

export interface DelegateEndEvent {
  parentAgent: string;
  childAgent: string;
  output: string;
  duration: number;
  conversationId: string;
  timestamp: number;
}

export interface ModelCallEvent {
  agentName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  duration: number;
  conversationId: string;
  timestamp: number;
}

// ── Event map ──

export interface LifecycleEventMap {
  // Summary level
  "agent:start": AgentStartEvent;
  "agent:end": AgentEndEvent;
  "agent:error": AgentErrorEvent;
  "job:start": JobStartEvent;
  "job:end": JobEndEvent;
  "job:cancelled": JobCancelledEvent;
  "cron:executed": CronExecutedEvent;
  // Trace level
  "tool:execute": ToolExecuteEvent;
  "delegate:start": DelegateStartEvent;
  "delegate:end": DelegateEndEvent;
  "model:call": ModelCallEvent;
}

export type LifecycleEventName = keyof LifecycleEventMap;

/** Wildcard event — original data plus a `type` field identifying which event fired */
export type WildcardEvent = { type: LifecycleEventName } & Record<string, unknown>;

// ── Trace event names ──

const TRACE_EVENTS = new Set<LifecycleEventName>([
  "tool:execute",
  "delegate:start",
  "delegate:end",
  "model:call",
]);

// ── Configuration ──

export type LifecycleHookLevel = "summary" | "trace";

export interface LifecycleHookConfig {
  level: LifecycleHookLevel;
}

// ── Emitter interface ──

type EventHandler<T> = (data: T) => void | Promise<void>;

export interface LifecycleHookEmitter {
  /** Subscribe to a specific lifecycle event. Returns an unsubscribe function. */
  on<E extends LifecycleEventName>(event: E, handler: EventHandler<LifecycleEventMap[E]>): () => void;
  /** Subscribe to all events. Handler receives data with `type` field. Returns an unsubscribe function. */
  on(event: "*", handler: EventHandler<WildcardEvent>): () => void;

  /** Emit a lifecycle event. Trace events are skipped at summary level. */
  emit<E extends LifecycleEventName>(event: E, data: LifecycleEventMap[E]): void;
}

// ── Implementation ──

class LifecycleHookEmitterImpl implements LifecycleHookEmitter {
  private handlers = new Map<string, EventHandler<any>[]>();
  private level: LifecycleHookLevel;

  constructor(config: LifecycleHookConfig) {
    this.level = config.level;
  }

  on(event: string, handler: EventHandler<any>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    const list = this.handlers.get(event)!;
    list.push(handler);

    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit<E extends LifecycleEventName>(event: E, data: LifecycleEventMap[E]): void {
    // Skip trace events at summary level
    if (this.level === "summary" && TRACE_EVENTS.has(event)) {
      return;
    }

    // Fire specific handlers
    const specific = this.handlers.get(event);
    if (specific) {
      for (const handler of specific) {
        try {
          handler(data);
        } catch {
          // Swallow — never break agent execution
        }
      }
    }

    // Fire wildcard handlers
    const wildcards = this.handlers.get("*");
    if (wildcards) {
      const wildcardData: WildcardEvent = { type: event, ...data } as WildcardEvent;
      for (const handler of wildcards) {
        try {
          handler(wildcardData);
        } catch {
          // Swallow — never break agent execution
        }
      }
    }
  }
}

/** Create a lifecycle hook emitter with the given detail level. */
export function createLifecycleHooks(config: LifecycleHookConfig): LifecycleHookEmitter {
  return new LifecycleHookEmitterImpl(config);
}
