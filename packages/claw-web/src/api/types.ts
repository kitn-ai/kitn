// Outbound from API
export interface OutboundMessage {
  text: string;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
}

// Status response
export interface StatusResponse {
  version: string;
  model: string;
  channels: string[];
}

// Session data
export interface SessionSummary {
  id: string;
  messageCount: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
  timestamp: string;
}

// Permission request (from WebSocket)
export interface PermissionRequest {
  toolName: string;
  input: unknown;
  summary: string;
  detail?: string;
  icon: string;
  destructive: boolean;
  canGrantDir: boolean;
  grantDirLabel?: string;
}

export type PermissionDecision = "allow" | "deny" | "trust" | "grant-dir";

// Governance
export interface DraftEntry {
  id: string;
  action: string;
  toolName: string;
  input: Record<string, unknown>;
  preview: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface BudgetSummary {
  [domain: string]: {
    spent: number;
    limit: number;
    remaining: number;
  };
}

// Memory
export interface MemoryEntry {
  key: string;
  value: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}

// Audit
export interface AuditEntry {
  event: string;
  toolName?: string;
  input?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  sessionId?: string;
  channelType?: string;
  duration?: number;
  createdAt: string;
}

// Tool info
export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  permissionLevel: string;
}

// Config (subset exposed to web UI)
export interface GatewayStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  configPath: string;
  homePath: string;
  sessions: number;
  workspaceTools: number;
  workspaceAgents: number;
  memoryDbExists: boolean;
}
