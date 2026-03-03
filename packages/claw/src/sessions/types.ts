export interface SessionEvent {
  type: "user" | "assistant" | "tool-call" | "tool-result";
  timestamp: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  metadata?: Record<string, unknown>;
}
