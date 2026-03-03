import type { Channel, OutboundMessage, PermissionRequest } from "../channels/types.js";

type MessageCallback = (sessionId: string, message: OutboundMessage) => void;
type PermissionCallback = (request: PermissionRequest) => void;

/**
 * Terminal channel — bridges the TUI to the ChannelManager.
 *
 * Messages flow:
 * TUI Input → ChannelManager.handleMessage() → agent loop → response
 * → TerminalChannel.send() → TUI renders the response
 */
export class TerminalChannel implements Channel {
  readonly type = "terminal";
  private onSend: MessageCallback | null = null;
  private onPermission: PermissionCallback | null = null;

  /**
   * Register callback for outbound messages (TUI will render these).
   */
  onMessage(callback: MessageCallback): void {
    this.onSend = callback;
  }

  /**
   * Register callback for permission requests (TUI will show prompt).
   */
  onPermissionPrompt(callback: PermissionCallback): void {
    this.onPermission = callback;
  }

  async start(): Promise<void> {
    // Terminal is always ready — no connection needed
  }

  async stop(): Promise<void> {
    this.onSend = null;
    this.onPermission = null;
  }

  async send(sessionId: string, message: OutboundMessage): Promise<void> {
    this.onSend?.(sessionId, message);
  }

  async onPermissionRequest(request: PermissionRequest): Promise<void> {
    this.onPermission?.(request);
  }
}
