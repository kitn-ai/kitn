import { describe, test, expect } from "bun:test";
import { ChannelManager } from "../src/channels/manager.js";
import type { Channel, OutboundMessage } from "../src/channels/types.js";
import { PermissionManager } from "../src/permissions/manager.js";
import {
  ToolRegistry,
  AgentRegistry,
  CardRegistry,
  createMemoryStorage,
  type PluginContext,
} from "@kitnai/core";

function createTestContext(): PluginContext {
  const storage = createMemoryStorage();
  return {
    agents: new AgentRegistry(),
    tools: new ToolRegistry(),
    cards: new CardRegistry(),
    storage,
    model: () => null as any,
    maxDelegationDepth: 3,
    defaultMaxSteps: 10,
    config: { model: () => null as any, storage },
  };
}

class MockChannel implements Channel {
  type = "test";
  started = false;
  stopped = false;
  sentMessages: Array<{ sessionId: string; message: OutboundMessage }> = [];

  async start() { this.started = true; }
  async stop() { this.stopped = true; }
  async send(sessionId: string, message: OutboundMessage) {
    this.sentMessages.push({ sessionId, message });
  }
}

describe("ChannelManager", () => {
  test("registers and retrieves channels", () => {
    const ctx = createTestContext();
    const permissions = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    const manager = new ChannelManager({
      ctx,
      config: { model: "test", channels: { terminal: { enabled: true } }, permissions: { trusted: [], requireConfirmation: [], denied: [] }, mcpServers: {}, registries: {}, gateway: { port: 18800, bind: "loopback" as const } },
      permissions,
    });

    const channel = new MockChannel();
    manager.register(channel);
    expect(manager.getChannel("test")).toBe(channel);
  });

  test("starts and stops all channels", async () => {
    const ctx = createTestContext();
    const permissions = new PermissionManager({ trusted: [], requireConfirmation: [], denied: [] });
    const manager = new ChannelManager({
      ctx,
      config: { model: "test", channels: { terminal: { enabled: true } }, permissions: { trusted: [], requireConfirmation: [], denied: [] }, mcpServers: {}, registries: {}, gateway: { port: 18800, bind: "loopback" as const } },
      permissions,
    });

    const ch1 = new MockChannel();
    ch1.type = "ch1";
    const ch2 = new MockChannel();
    ch2.type = "ch2";

    manager.register(ch1);
    manager.register(ch2);

    await manager.startAll();
    expect(ch1.started).toBe(true);
    expect(ch2.started).toBe(true);

    await manager.stopAll();
    expect(ch1.stopped).toBe(true);
    expect(ch2.stopped).toBe(true);
  });
});
