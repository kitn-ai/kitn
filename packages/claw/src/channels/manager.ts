import type { Channel, InboundMessage, OutboundMessage, PermissionRequest } from "./types.js";
import type { AgentLoopOptions, AgentResponse } from "../agent/loop.js";
import { runAgentLoop } from "../agent/loop.js";
import { SessionManager } from "../sessions/manager.js";
import type { PermissionHandler } from "../agent/wrapped-tools.js";

/**
 * Routes messages between channels and the agent loop.
 * Each channel registers here; inbound messages are queued
 * through the SessionManager for serial execution.
 */
export class ChannelManager {
  private channels = new Map<string, Channel>();
  private sessions = new SessionManager();
  private agentOpts: Omit<AgentLoopOptions, "sessionId" | "channelType" | "permissionHandler">;

  constructor(
    opts: Omit<AgentLoopOptions, "sessionId" | "channelType" | "permissionHandler">,
  ) {
    this.agentOpts = opts;
  }

  register(channel: Channel): void {
    this.channels.set(channel.type, channel);
  }

  getChannel(type: string): Channel | undefined {
    return this.channels.get(type);
  }

  /**
   * Handle an inbound message from any channel.
   * Routes through session manager for serial execution.
   */
  async handleMessage(message: InboundMessage): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      this.sessions.enqueue(message.sessionId, async () => {
        try {
          const channel = this.channels.get(message.channelType);

          // Create a permission handler that delegates to the channel
          const permissionHandler: PermissionHandler = {
            onConfirm: async (toolName: string, input: unknown) => {
              if (channel?.onPermissionRequest) {
                return new Promise<"allow" | "deny" | "trust" | "grant-dir">((res) => {
                  channel.onPermissionRequest!({
                    toolName,
                    input,
                    resolve: res,
                  });
                });
              }
              // No channel permission handler — default to deny
              return "deny";
            },
          };

          const response = await runAgentLoop(message.text, {
            ...this.agentOpts,
            sessionId: message.sessionId,
            channelType: message.channelType,
            permissionHandler,
          });

          // Send response back through the channel
          if (channel) {
            await channel.send(message.sessionId, {
              text: response.text,
              toolCalls: response.toolCalls,
            });
          }

          resolve(response);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }
}
