/**
 * Self-registration module tests.
 * Run with: bun test packages/core/test/self-register.test.ts
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  registerAgent,
  registerTool,
  registerCommand,
  registerSkill,
  registerWithPlugin,
  _resetForTesting,
} from "../src/registry/self-register.js";
import type { PluginContext } from "../src/types.js";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import { ToolRegistry } from "../src/registry/tool-registry.js";
import { CardRegistry } from "../src/utils/card-registry.js";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";

function createMockCtx(): PluginContext {
  return {
    agents: new AgentRegistry(),
    tools: new ToolRegistry(),
    storage: createMemoryStorage(),
    model: () => ({}) as any,
    cards: new CardRegistry(),
    maxDelegationDepth: 3,
    defaultMaxSteps: 5,
    config: { model: () => ({}) as any },
  };
}

describe("self-register", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  test("registerAgent collects config and registerWithPlugin flushes to ctx.agents.register", () => {
    const ctx = createMockCtx();

    registerAgent({
      name: "test-agent",
      description: "A test agent",
      system: "You are a test agent.",
      tools: {},
    });

    registerWithPlugin(ctx);

    const registered = ctx.agents.get("test-agent");
    expect(registered).toBeDefined();
    expect(registered!.name).toBe("test-agent");
    expect(registered!.description).toBe("A test agent");
    expect(registered!.defaultSystem).toBe("You are a test agent.");
  });

  test("registerTool collects config and flushes to ctx.tools.register", () => {
    const ctx = createMockCtx();

    const mockTool = { execute: async () => "result" };
    registerTool({
      name: "test-tool",
      description: "A test tool",
      inputSchema: z.object({ query: z.string() }),
      tool: mockTool,
    });

    registerWithPlugin(ctx);

    const registered = ctx.tools.get("test-tool");
    expect(registered).toBeDefined();
    expect(registered!.name).toBe("test-tool");
    expect(registered!.description).toBe("A test tool");
    expect(registered!.tool).toBe(mockTool);
  });

  test("agent registration creates both json and sse handlers", () => {
    const ctx = createMockCtx();

    registerAgent({
      name: "dual-handler-agent",
      description: "Has both handlers",
      system: "System prompt",
      tools: {},
    });

    registerWithPlugin(ctx);

    const registered = ctx.agents.get("dual-handler-agent");
    expect(registered).toBeDefined();
    expect(registered!.jsonHandler).toBeDefined();
    expect(typeof registered!.jsonHandler).toBe("function");
    expect(registered!.sseHandler).toBeDefined();
    expect(typeof registered!.sseHandler).toBe("function");
  });

  test("registerWithPlugin is idempotent (maps cleared after flush)", () => {
    const ctx = createMockCtx();

    registerAgent({
      name: "once-agent",
      description: "Should only register once",
      system: "System",
      tools: {},
    });

    registerWithPlugin(ctx);
    expect(ctx.agents.get("once-agent")).toBeDefined();

    // Create a fresh context and flush again — nothing should register
    const ctx2 = createMockCtx();
    registerWithPlugin(ctx2);
    expect(ctx2.agents.get("once-agent")).toBeUndefined();
  });

  test("multiple agents and tools register together", () => {
    const ctx = createMockCtx();

    registerTool({
      name: "tool-a",
      description: "Tool A",
      inputSchema: z.object({}),
      tool: { execute: async () => "a" },
    });

    registerTool({
      name: "tool-b",
      description: "Tool B",
      inputSchema: z.object({}),
      tool: { execute: async () => "b" },
    });

    registerAgent({
      name: "agent-1",
      description: "Agent 1",
      system: "System 1",
      tools: {},
    });

    registerAgent({
      name: "agent-2",
      description: "Agent 2",
      system: "System 2",
      tools: {},
    });

    registerWithPlugin(ctx);

    expect(ctx.tools.get("tool-a")).toBeDefined();
    expect(ctx.tools.get("tool-b")).toBeDefined();
    expect(ctx.agents.get("agent-1")).toBeDefined();
    expect(ctx.agents.get("agent-2")).toBeDefined();
  });

  test("registerCommand stores command for later flush", () => {
    registerCommand({
      name: "test-command",
      description: "A test command",
      system: "You execute the test command.",
      tools: ["tool-a"],
      model: "gpt-4",
      format: "json",
    });

    // Command is collected — when flushed, it would go to storage.commands
    // Since CommandStore doesn't exist yet, we just verify no errors
    const ctx = createMockCtx();
    registerWithPlugin(ctx);
    // No error means it handled the missing commands store gracefully
  });

  test("agent format defaults to sse", () => {
    const ctx = createMockCtx();

    registerAgent({
      name: "default-format-agent",
      description: "Default format",
      system: "System",
      tools: {},
    });

    registerWithPlugin(ctx);

    const registered = ctx.agents.get("default-format-agent");
    expect(registered).toBeDefined();
    expect(registered!.defaultFormat).toBe("sse");
  });

  test("agent format can be overridden to json", () => {
    const ctx = createMockCtx();

    registerAgent({
      name: "json-agent",
      description: "JSON format agent",
      system: "System",
      tools: {},
      format: "json",
    });

    registerWithPlugin(ctx);

    const registered = ctx.agents.get("json-agent");
    expect(registered).toBeDefined();
    expect(registered!.defaultFormat).toBe("json");
  });

  test("registerSkill collects skill config", () => {
    registerSkill({
      name: "test-skill",
      description: "A test skill",
    });

    // Skills are collected — verify no errors on flush
    const ctx = createMockCtx();
    registerWithPlugin(ctx);
  });

  test("tool with directExecute and category is preserved", () => {
    const ctx = createMockCtx();
    const directFn = async (input: any) => input;

    registerTool({
      name: "categorized-tool",
      description: "Has category",
      inputSchema: z.object({}),
      tool: { execute: async () => "x" },
      directExecute: directFn,
      category: "utilities",
    });

    registerWithPlugin(ctx);

    const registered = ctx.tools.get("categorized-tool");
    expect(registered).toBeDefined();
    expect(registered!.directExecute).toBe(directFn);
    expect(registered!.category).toBe("utilities");
  });

  test("tools are registered before agents", () => {
    const ctx = createMockCtx();
    const registrationOrder: string[] = [];

    // Spy on registrations by wrapping the register methods
    const origToolRegister = ctx.tools.register.bind(ctx.tools);
    ctx.tools.register = (reg) => {
      registrationOrder.push(`tool:${reg.name}`);
      origToolRegister(reg);
    };

    const origAgentRegister = ctx.agents.register.bind(ctx.agents);
    ctx.agents.register = (reg) => {
      registrationOrder.push(`agent:${reg.name}`);
      origAgentRegister(reg);
    };

    registerTool({
      name: "my-tool",
      description: "A tool",
      inputSchema: z.object({}),
      tool: { execute: async () => "ok" },
    });

    registerAgent({
      name: "my-agent",
      description: "An agent",
      system: "System",
      tools: {},
    });

    registerWithPlugin(ctx);

    expect(registrationOrder[0]).toBe("tool:my-tool");
    expect(registrationOrder[1]).toBe("agent:my-agent");
  });
});
