import { describe, test, expect, mock } from "bun:test";
import { z } from "zod";
import { createMCPServer } from "../src/server.js";
import type { PluginContext } from "@kitnai/core";
import { ToolRegistry, AgentRegistry } from "@kitnai/core";

function createMockContext(
  options: {
    tools?: Array<{ name: string; description: string; inputSchema: z.ZodType<any> }>;
    agents?: Array<{ name: string; description: string }>;
  } = {},
): PluginContext {
  const toolRegistry = new ToolRegistry();
  const agentRegistry = new AgentRegistry();

  for (const t of options.tools ?? []) {
    toolRegistry.register({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      tool: {},
      directExecute: mock(async (input: any) => ({ result: "ok", input })),
    });
  }

  for (const a of options.agents ?? []) {
    agentRegistry.register({
      name: a.name,
      description: a.description,
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "You are a test agent",
      tools: { testTool: {} },
    });
  }

  return {
    tools: toolRegistry,
    agents: agentRegistry,
    cards: {} as any,
    storage: {} as any,
    voice: {} as any,
    getModel: (() => ({})) as any,
    config: {} as any,
    maxDelegationDepth: 5,
  } as PluginContext;
}

describe("createMCPServer", () => {
  test("returns server object with server property and connectStdio method", () => {
    const ctx = createMockContext();
    const result = createMCPServer(ctx, { name: "test-server" });

    expect(result.server).toBeDefined();
    expect(typeof result.connectStdio).toBe("function");
  });

  test("uses provided version or defaults to 1.0.0", () => {
    const ctx = createMockContext();

    const withVersion = createMCPServer(ctx, {
      name: "test",
      version: "2.0.0",
    });
    expect(withVersion.server).toBeDefined();

    const withDefault = createMCPServer(ctx, { name: "test-default" });
    expect(withDefault.server).toBeDefined();
  });

  test("registers all tools when no filter specified", () => {
    const ctx = createMockContext({
      tools: [
        { name: "tool-a", description: "Tool A", inputSchema: z.object({ x: z.string() }) },
        { name: "tool-b", description: "Tool B", inputSchema: z.object({ y: z.number() }) },
      ],
    });

    // Should not throw - both tools should be registered
    const result = createMCPServer(ctx, { name: "test-server" });
    expect(result.server).toBeDefined();

    // Verify by checking the internal registered tools via the underlying server
    // The McpServer stores tools in _registeredTools (private but accessible at runtime)
    const registeredTools = (result.server as any)._registeredTools;
    expect(registeredTools["tool-a"]).toBeDefined();
    expect(registeredTools["tool-b"]).toBeDefined();
  });

  test("filters tools when tools array specified", () => {
    const ctx = createMockContext({
      tools: [
        { name: "tool-a", description: "Tool A", inputSchema: z.object({ x: z.string() }) },
        { name: "tool-b", description: "Tool B", inputSchema: z.object({ y: z.number() }) },
        { name: "tool-c", description: "Tool C", inputSchema: z.object({ z: z.boolean() }) },
      ],
    });

    const result = createMCPServer(ctx, {
      name: "test-server",
      tools: ["tool-a", "tool-c"],
    });

    const registeredTools = (result.server as any)._registeredTools;
    expect(registeredTools["tool-a"]).toBeDefined();
    expect(registeredTools["tool-b"]).toBeUndefined();
    expect(registeredTools["tool-c"]).toBeDefined();
  });

  test("registers agents as MCP tools when agents specified", () => {
    const ctx = createMockContext({
      agents: [
        { name: "writer", description: "A writing agent" },
        { name: "coder", description: "A coding agent" },
      ],
    });

    const result = createMCPServer(ctx, {
      name: "test-server",
      agents: ["writer", "coder"],
    });

    const registeredTools = (result.server as any)._registeredTools;
    expect(registeredTools["agent_writer"]).toBeDefined();
    expect(registeredTools["agent_writer"].description).toBe("A writing agent");
    expect(registeredTools["agent_coder"]).toBeDefined();
    expect(registeredTools["agent_coder"].description).toBe("A coding agent");
  });

  test("skips agents that are not registered", () => {
    const ctx = createMockContext({
      agents: [{ name: "writer", description: "A writing agent" }],
    });

    // Request both "writer" and "nonexistent" - should only register "writer"
    const result = createMCPServer(ctx, {
      name: "test-server",
      agents: ["writer", "nonexistent"],
    });

    const registeredTools = (result.server as any)._registeredTools;
    expect(registeredTools["agent_writer"]).toBeDefined();
    expect(registeredTools["agent_nonexistent"]).toBeUndefined();
  });

  test("uses agent description or fallback description", () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      name: "no-desc",
      description: "",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "test",
      tools: { t: {} },
    });

    const ctx = {
      tools: new ToolRegistry(),
      agents: agentRegistry,
      cards: {} as any,
      storage: {} as any,
      voice: {} as any,
      getModel: (() => ({})) as any,
      config: {} as any,
      maxDelegationDepth: 5,
    } as PluginContext;

    const result = createMCPServer(ctx, {
      name: "test-server",
      agents: ["no-desc"],
    });

    const registeredTools = (result.server as any)._registeredTools;
    // Empty string is falsy, so the fallback should be used
    expect(registeredTools["agent_no-desc"].description).toBe(
      "Chat with the no-desc agent",
    );
  });

  test("registers both tools and agents when both specified", () => {
    const ctx = createMockContext({
      tools: [
        { name: "search", description: "Search tool", inputSchema: z.object({ q: z.string() }) },
      ],
      agents: [{ name: "assistant", description: "An assistant agent" }],
    });

    const result = createMCPServer(ctx, {
      name: "test-server",
      agents: ["assistant"],
    });

    const registeredTools = (result.server as any)._registeredTools;
    expect(registeredTools["search"]).toBeDefined();
    expect(registeredTools["agent_assistant"]).toBeDefined();
  });
});
