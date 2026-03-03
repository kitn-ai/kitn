import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../src/permissions/manager.js";
import { wrapToolsWithPermissions, type PermissionHandler } from "../src/agent/wrapped-tools.js";
import {
  ToolRegistry,
  AgentRegistry,
  CardRegistry,
  createMemoryStorage,
  type PluginContext,
} from "@kitnai/core";
import { tool } from "ai";
import { z } from "zod";

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

const echoTool = tool({
  description: "Echo input",
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => ({ echoed: message }),
});

function makePermissions(overrides?: {
  profile?: "cautious" | "balanced" | "autonomous";
  denied?: string[];
  sandbox?: string;
  grantedDirs?: string[];
}) {
  return new PermissionManager({
    profile: overrides?.profile ?? "balanced",
    grantedDirs: overrides?.grantedDirs ?? [],
    sandbox: overrides?.sandbox ?? "/tmp/test-workspace",
    denied: overrides?.denied,
  });
}

describe("wrapToolsWithPermissions", () => {
  test("allows safe tools without confirmation", async () => {
    const ctx = createTestContext();
    ctx.tools.register({
      name: "file-read",
      description: "Read files",
      inputSchema: echoTool.inputSchema,
      tool: echoTool,
    });

    const pm = makePermissions();
    const handler: PermissionHandler = {
      onConfirm: async () => "deny", // should never be called
    };

    const wrapped = wrapToolsWithPermissions(ctx, pm, handler);
    expect(wrapped["file-read"]).toBeDefined();

    const result = await wrapped["file-read"].execute!(
      { message: "test" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.echoed).toBe("test");
  });

  test("blocks denied tools", async () => {
    const ctx = createTestContext();
    ctx.tools.register({
      name: "bash",
      description: "Shell",
      inputSchema: echoTool.inputSchema,
      tool: echoTool,
    });

    const pm = makePermissions({ denied: ["bash"] });
    const handler: PermissionHandler = {
      onConfirm: async () => "allow",
    };

    const wrapped = wrapToolsWithPermissions(ctx, pm, handler);
    const result = await wrapped["bash"].execute!(
      { message: "test" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.error).toContain("denied");
  });

  test("prompts for confirmation on moderate tools", async () => {
    const ctx = createTestContext();
    ctx.tools.register({
      name: "file-write",
      description: "Write files",
      inputSchema: echoTool.inputSchema,
      tool: echoTool,
    });

    let confirmCalled = false;
    const pm = makePermissions();
    const handler: PermissionHandler = {
      onConfirm: async () => {
        confirmCalled = true;
        return "allow";
      },
    };

    const wrapped = wrapToolsWithPermissions(ctx, pm, handler);
    // file-write with no path (or a path outside sandbox) should trigger confirm in balanced profile
    const result = await wrapped["file-write"].execute!(
      { message: "test" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(confirmCalled).toBe(true);
    expect(result.echoed).toBe("test");
  });

  test("trust response skips future confirmations", async () => {
    const ctx = createTestContext();
    ctx.tools.register({
      name: "file-write",
      description: "Write files",
      inputSchema: echoTool.inputSchema,
      tool: echoTool,
    });

    let confirmCount = 0;
    const pm = makePermissions();
    const handler: PermissionHandler = {
      onConfirm: async () => {
        confirmCount++;
        return "trust";
      },
    };

    const wrapped = wrapToolsWithPermissions(ctx, pm, handler);

    // First call — should prompt
    await wrapped["file-write"].execute!(
      { message: "first" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(confirmCount).toBe(1);

    // Second call — should NOT prompt (session trusted)
    await wrapped["file-write"].execute!(
      { message: "second" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(confirmCount).toBe(1); // still 1
  });
});
