export interface InboundMessage {
  sessionId: string;
  text: string;
  channelType: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  text: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }>;
}

export interface PermissionRequest {
  toolName: string;
  input: unknown;
  resolve: (decision: "allow" | "deny" | "trust" | "grant-dir") => void;
}

export interface Channel {
  readonly type: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(sessionId: string, message: OutboundMessage): Promise<void>;
  onPermissionRequest?(request: PermissionRequest): Promise<void>;
}
