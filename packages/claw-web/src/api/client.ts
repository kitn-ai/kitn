import type {
  OutboundMessage,
  StatusResponse,
  SessionSummary,
  ChatMessage,
  PermissionRequest,
  PermissionDecision,
  DraftEntry,
  BudgetSummary,
  MemoryEntry,
  AuditEntry,
  ToolInfo,
  GatewayStatus,
} from "./types.js";

export type {
  OutboundMessage,
  StatusResponse,
  SessionSummary,
  ChatMessage,
  PermissionRequest,
  PermissionDecision,
  DraftEntry,
  BudgetSummary,
  MemoryEntry,
  AuditEntry,
  ToolInfo,
  GatewayStatus,
};

// WebSocket frame types sent from server
export type WsFrame =
  | { type: "permission"; payload: PermissionRequest }
  | { type: "message"; payload: OutboundMessage }
  | { type: "error"; payload: { message: string } }
  | { type: "connected"; payload: { sessionId: string } };

export interface WsCallbacks {
  onPermission?: (req: PermissionRequest) => void;
  onMessage?: (msg: OutboundMessage) => void;
  onError?: (err: { message: string }) => void;
  onConnected?: (info: { sessionId: string }) => void;
  onClose?: () => void;
}

export interface WsHandle {
  send: (data: unknown) => void;
  decide: (toolName: string, decision: PermissionDecision) => void;
  close: () => void;
}

export interface SseCleanup {
  (): void;
}

export interface ClientOptions {
  baseUrl?: string;
  token?: string;
}

export class KitnClawClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(options: ClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      (typeof window !== "undefined" ? window.location.origin : "");
    this.token = options.token;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    if (this.token) {
      return { Authorization: `Bearer ${this.token}` };
    }
    return {};
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = (body as { error?: string; message?: string }).error
          ?? (body as { error?: string; message?: string }).message
          ?? message;
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Health / Status
  // -------------------------------------------------------------------------

  async getHealth(): Promise<{ status: string } | null> {
    try {
      return await this.request<{ status: string }>("/health");
    } catch {
      return null;
    }
  }

  async getStatus(token?: string): Promise<StatusResponse | null> {
    if (token !== undefined) this.setToken(token);
    try {
      return await this.request<StatusResponse>("/api/status");
    } catch {
      return null;
    }
  }

  async getGatewayStatus(): Promise<GatewayStatus> {
    return this.request<GatewayStatus>("/api/gateway/status");
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async listSessions(): Promise<SessionSummary[]> {
    return this.request<SessionSummary[]>("/api/sessions");
  }

  async getSession(sessionId: string): Promise<ChatMessage[]> {
    return this.request<ChatMessage[]>(`/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  async sendMessage(
    sessionId: string,
    text: string,
    token?: string,
  ): Promise<OutboundMessage> {
    if (token !== undefined) this.setToken(token);
    return this.request<OutboundMessage>("/api/message", {
      method: "POST",
      body: JSON.stringify({ sessionId, text }),
    });
  }

  // -------------------------------------------------------------------------
  // SSE streaming
  // -------------------------------------------------------------------------

  /**
   * Opens a server-sent events stream for the given session.
   * Parses each `data:` JSON event and calls `onMessage`.
   * Returns a cleanup function that closes the EventSource.
   */
  connectSSE(
    sessionId: string,
    onMessage: (msg: OutboundMessage) => void,
    onError?: (err: Event) => void
  ): SseCleanup {
    const params = new URLSearchParams({ sessionId });
    if (this.token) {
      params.set("token", this.token);
    }
    const url = `${this.baseUrl}/api/stream?${params.toString()}`;

    const source = new EventSource(url);

    source.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as OutboundMessage;
        onMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    });

    if (onError) {
      source.addEventListener("error", onError);
    }

    return () => {
      source.close();
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  /**
   * Connects to the KitnClaw WebSocket endpoint.
   * Handles incoming JSON frames and dispatches to the provided callbacks.
   * Returns a handle with `send`, `decide`, and `close` methods.
   */
  connectWebSocket(callbacks: WsCallbacks = {}): WsHandle {
    const params = new URLSearchParams();
    if (this.token) {
      params.set("token", this.token);
    }

    const protocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const host = this.baseUrl.replace(/^https?/, "");
    const query = params.toString() ? `?${params.toString()}` : "";
    const url = `${protocol}${host}/ws${query}`;

    const ws = new WebSocket(url);

    ws.addEventListener("message", (event: MessageEvent<string>) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(event.data) as WsFrame;
      } catch {
        return;
      }

      switch (frame.type) {
        case "permission":
          callbacks.onPermission?.(frame.payload);
          break;
        case "message":
          callbacks.onMessage?.(frame.payload);
          break;
        case "error":
          callbacks.onError?.(frame.payload);
          break;
        case "connected":
          callbacks.onConnected?.(frame.payload);
          break;
      }
    });

    ws.addEventListener("close", () => {
      callbacks.onClose?.();
    });

    const send = (data: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    };

    const decide = (toolName: string, decision: PermissionDecision): void => {
      send({ type: "permission-decision", toolName, decision });
    };

    const close = (): void => {
      ws.close();
    };

    return { send, decide, close };
  }

  // -------------------------------------------------------------------------
  // Governance
  // -------------------------------------------------------------------------

  async listDrafts(status?: DraftEntry["status"]): Promise<DraftEntry[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<DraftEntry[]>(`/api/governance/drafts${params}`);
  }

  async approveDraft(id: string): Promise<void> {
    await this.request<void>(`/api/governance/drafts/${encodeURIComponent(id)}/approve`, {
      method: "POST",
    });
  }

  async rejectDraft(id: string): Promise<void> {
    await this.request<void>(`/api/governance/drafts/${encodeURIComponent(id)}/reject`, {
      method: "POST",
    });
  }

  async getBudget(): Promise<BudgetSummary> {
    return this.request<BudgetSummary>("/api/governance/budget");
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  async listMemory(): Promise<MemoryEntry[]> {
    return this.request<MemoryEntry[]>("/api/memory");
  }

  async deleteMemoryEntry(key: string): Promise<void> {
    await this.request<void>(`/api/memory/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async listAudit(limit?: number): Promise<AuditEntry[]> {
    const params = limit !== undefined ? `?limit=${limit}` : "";
    return this.request<AuditEntry[]>(`/api/audit${params}`);
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  async listTools(): Promise<ToolInfo[]> {
    return this.request<ToolInfo[]>("/api/tools");
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _client: KitnClawClient | undefined;

export function getClient(options?: ClientOptions): KitnClawClient {
  if (!_client) {
    _client = new KitnClawClient(options);
  }
  return _client;
}

export function createClient(options: ClientOptions = {}): KitnClawClient {
  return new KitnClawClient(options);
}

/** Default singleton client instance */
export const apiClient = getClient();
