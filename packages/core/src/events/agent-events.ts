export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (event: AgentEvent) => void | Promise<void>;

export class AgentEventBus {
  private handlers: EventHandler[] = [];

  subscribe(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  emit(type: string, data: Record<string, unknown> = {}): void {
    const event: AgentEvent = { type, data, timestamp: Date.now() };
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[agent-events] handler error:", err);
      }
    }
  }
}
