/**
 * Orchestrator delegation flow tests.
 * Run with: bun test packages/core/test/orchestrator.test.ts
 */
import { describe, test, expect } from "bun:test";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import { AgentEventBus } from "../src/events/agent-events.js";
import { BUS_EVENTS } from "../src/events/events.js";
import { TOOL_NAMES, DEFAULTS } from "../src/utils/constants.js";
import { delegationStore, getEventBus, getOrchestratorAgents } from "../src/utils/delegation-context.js";
import { createOrchestratorAgent } from "../src/agents/orchestrator.js";
import { executeTask } from "../src/agents/execute-task.js";
import { makeCtx, helloTool, registerSpecialist } from "./helpers.js";

// ── 1. Orchestrator registration ──────────────────────────────────────────────

describe("createOrchestratorAgent", () => {
  test("registers an agent with isOrchestrator: true", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, { name: "main-orchestrator" });

    const reg = ctx.agents.get("main-orchestrator");
    expect(reg).toBeDefined();
    expect(reg!.isOrchestrator).toBe(true);
  });

  test("registered orchestrator has both sseHandler and jsonHandler", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, { name: "main-orchestrator" });

    const reg = ctx.agents.get("main-orchestrator");
    expect(reg).toBeDefined();
    expect(reg!.sseHandler).toBeFunction();
    expect(reg!.jsonHandler).toBeFunction();
  });

  test("orchestrator description defaults when not provided", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, { name: "auto-desc-orchestrator" });

    const reg = ctx.agents.get("auto-desc-orchestrator");
    expect(reg!.description).toBeString();
    expect(reg!.description.length).toBeGreaterThan(0);
  });

  test("orchestrator uses custom description when provided", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, {
      name: "custom-orchestrator",
      description: "My custom orchestrator",
    });

    const reg = ctx.agents.get("custom-orchestrator");
    expect(reg!.description).toBe("My custom orchestrator");
  });

  test("orchestrator toolNames include routeToAgent and createTask", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, { name: "routing-orchestrator" });

    const reg = ctx.agents.get("routing-orchestrator");
    expect(reg!.toolNames).toContain(TOOL_NAMES.ROUTE_TO_AGENT);
    expect(reg!.toolNames).toContain(TOOL_NAMES.CREATE_TASK);
  });

  test("orchestrator uses custom systemPrompt when provided", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, {
      name: "custom-prompt-orchestrator",
      systemPrompt: "Custom system prompt here.",
    });

    const reg = ctx.agents.get("custom-prompt-orchestrator");
    expect(reg!.defaultSystem).toBe("Custom system prompt here.");
  });

  test("multiple orchestrators can be registered", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    registerSpecialist(ctx, "news");

    createOrchestratorAgent(ctx, { name: "orchestrator-a" });
    createOrchestratorAgent(ctx, { name: "orchestrator-b" });

    expect(ctx.agents.get("orchestrator-a")).toBeDefined();
    expect(ctx.agents.get("orchestrator-b")).toBeDefined();
    expect(ctx.agents.get("orchestrator-a")!.isOrchestrator).toBe(true);
    expect(ctx.agents.get("orchestrator-b")!.isOrchestrator).toBe(true);
  });

  test("orchestrator stores allowed agents list when provided", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    registerSpecialist(ctx, "news");

    createOrchestratorAgent(ctx, {
      name: "limited-orchestrator",
      agents: ["weather"],
    });

    const reg = ctx.agents.get("limited-orchestrator");
    expect(reg!.agents).toEqual(["weather"]);
  });
});

// ── 2. AgentRegistry orchestrator helpers ─────────────────────────────────────

describe("AgentRegistry.getOrchestratorNames", () => {
  test("returns empty set when no orchestrators registered", () => {
    const registry = new AgentRegistry();
    expect(registry.getOrchestratorNames().size).toBe(0);
  });

  test("returns set containing orchestrator names", () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "orch-1",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "sys",
      isOrchestrator: true,
    });
    registry.register({
      name: "specialist",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "sys",
      isOrchestrator: false,
    });

    const names = registry.getOrchestratorNames();
    expect(names.has("orch-1")).toBe(true);
    expect(names.has("specialist")).toBe(false);
  });

  test("non-orchestrator agents are excluded from orchestrator set", () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "ordinary-agent",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "sys",
    });

    expect(registry.getOrchestratorNames().size).toBe(0);
  });
});

// ── 3. getOrchestratorAgents (delegation-context helper) ─────────────────────

describe("getOrchestratorAgents", () => {
  test("returns names of all orchestrator agents in registry", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "specialist-a");
    createOrchestratorAgent(ctx, { name: "orch-main" });

    const orchSet = getOrchestratorAgents(ctx.agents);
    expect(orchSet.has("orch-main")).toBe(true);
    expect(orchSet.has("specialist-a")).toBe(false);
  });

  test("returns empty set when no orchestrators registered", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    const orchSet = getOrchestratorAgents(ctx.agents);
    expect(orchSet.size).toBe(0);
  });

  test("multiple orchestrators all appear in set", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    createOrchestratorAgent(ctx, { name: "orch-a" });
    createOrchestratorAgent(ctx, { name: "orch-b" });

    const orchSet = getOrchestratorAgents(ctx.agents);
    expect(orchSet.has("orch-a")).toBe(true);
    expect(orchSet.has("orch-b")).toBe(true);
    expect(orchSet.has("weather")).toBe(false);
  });
});

// ── 4. executeTask – error paths ──────────────────────────────────────────────

describe("executeTask – error paths", () => {
  test("returns error for unknown agent", async () => {
    const ctx = makeCtx();
    const result = await executeTask(ctx, "nonexistent-agent", "hello");

    expect(result.agent).toBe("nonexistent-agent");
    expect(result.query).toBe("hello");
    expect(result.result.response).toContain("Unknown agent");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("returns error when delegating to an orchestrator agent", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    createOrchestratorAgent(ctx, { name: "main-orch" });

    const result = await executeTask(ctx, "main-orch", "what is the weather?");

    expect(result.result.response).toContain("orchestrator");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("returns error for agent without tools", async () => {
    const ctx = makeCtx();
    // Register agent with no tools
    ctx.agents.register({
      name: "toolless-agent",
      description: "No tools here",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "You have no tools.",
      tools: {},
    });

    const result = await executeTask(ctx, "toolless-agent", "do something");

    expect(result.result.response).toContain("does not support task execution");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("returns error when delegation depth is exceeded", async () => {
    const ctx = makeCtx({ maxDelegationDepth: 0 });
    registerSpecialist(ctx, "specialist");

    // Simulate being at depth 0 already (which meets the >= check for maxDepth 0)
    const delegCtx = {
      chain: [],
      depth: 0,
    };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "specialist", "deep query")
    );

    expect(result.result.response).toContain("Delegation depth limit");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("returns error on self-delegation (agent delegates to itself)", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "specialist");

    // Simulate a context where "specialist" is already the last in chain
    const delegCtx = {
      chain: ["specialist"],
      depth: 1,
    };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "specialist", "recursive query")
    );

    expect(result.result.response).toContain("Self-delegation blocked");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("returns error on circular delegation", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "agent-a");
    registerSpecialist(ctx, "agent-b");

    // Simulate chain: agent-a -> agent-b -> (trying agent-a again)
    const delegCtx = {
      chain: ["agent-a", "agent-b"],
      depth: 2,
    };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "agent-a", "circular query")
    );

    expect(result.result.response).toContain("Circular delegation blocked");
    expect(result.result.toolsUsed).toEqual([]);
  });
});

// ── 5. executeTask – guard hook ───────────────────────────────────────────────

describe("executeTask – guard hook", () => {
  test("guard blocking returns an error result without calling runAgent", async () => {
    const ctx = makeCtx();
    ctx.agents.register({
      name: "guarded",
      description: "A guarded agent",
      toolNames: ["hello"],
      defaultFormat: "json",
      defaultSystem: "You are guarded.",
      tools: { hello: helloTool },
      guard: async (query) => {
        if (query.includes("forbidden")) {
          return { allowed: false, reason: "Forbidden content detected" };
        }
        return { allowed: true };
      },
    });

    const result = await executeTask(ctx, "guarded", "this is forbidden content");

    expect(result.result.response).toContain("Guard blocked");
    expect(result.result.response).toContain("Forbidden content detected");
    expect(result.result.toolsUsed).toEqual([]);
  });

  test("guard allowing proceeds without error", async () => {
    const ctx = makeCtx();
    ctx.agents.register({
      name: "lenient-guarded",
      description: "A guarded agent that allows most queries",
      toolNames: ["hello"],
      defaultFormat: "json",
      defaultSystem: "You are lenient.",
      tools: { hello: helloTool },
      guard: async () => ({ allowed: true }),
    });

    // This will actually call runAgent which calls generateText — the mock model
    // returns a simple string. The result should not contain guard error messages.
    const result = await executeTask(ctx, "lenient-guarded", "safe query");

    expect(result.result.response).not.toContain("Guard blocked");
    expect(result.agent).toBe("lenient-guarded");
  });
});

// ── 6. AgentEventBus ──────────────────────────────────────────────────────────

describe("AgentEventBus", () => {
  test("subscribe receives emitted events", () => {
    const bus = new AgentEventBus();
    const received: Array<{ type: string; data: Record<string, unknown> }> = [];

    bus.subscribe((event) => {
      received.push({ type: event.type, data: event.data });
    });

    bus.emit(BUS_EVENTS.DELEGATE_START, { from: "orch", to: "weather", query: "hello" });
    bus.emit(BUS_EVENTS.DELEGATE_END, { from: "orch", to: "weather", summary: "done" });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe(BUS_EVENTS.DELEGATE_START);
    expect(received[0].data.from).toBe("orch");
    expect(received[1].type).toBe(BUS_EVENTS.DELEGATE_END);
  });

  test("unsubscribe stops receiving events", () => {
    const bus = new AgentEventBus();
    const received: string[] = [];

    const unsub = bus.subscribe((event) => {
      received.push(event.type);
    });

    bus.emit(BUS_EVENTS.TOOL_CALL, { tool: "hello" });
    unsub();
    bus.emit(BUS_EVENTS.TOOL_RESULT, { tool: "hello", result: "done" });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(BUS_EVENTS.TOOL_CALL);
  });

  test("multiple subscribers all receive events", () => {
    const bus = new AgentEventBus();
    let countA = 0;
    let countB = 0;

    bus.subscribe(() => { countA++; });
    bus.subscribe(() => { countB++; });

    bus.emit(BUS_EVENTS.DELEGATE_START, {});

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  test("handler errors are swallowed without breaking emission", () => {
    const bus = new AgentEventBus();
    let secondHandlerCalled = false;

    bus.subscribe(() => {
      throw new Error("handler error");
    });

    bus.subscribe(() => {
      secondHandlerCalled = true;
    });

    // Should not throw
    expect(() => bus.emit(BUS_EVENTS.DELEGATE_START, {})).not.toThrow();
    expect(secondHandlerCalled).toBe(true);
  });

  test("emit always attaches a numeric timestamp", () => {
    const bus = new AgentEventBus();
    let capturedTimestamp: number | undefined;

    bus.subscribe((event) => {
      capturedTimestamp = event.timestamp;
    });

    const before = Date.now();
    bus.emit(BUS_EVENTS.TOOL_CALL, { tool: "test" });
    const after = Date.now();

    expect(capturedTimestamp).toBeGreaterThanOrEqual(before);
    expect(capturedTimestamp).toBeLessThanOrEqual(after);
  });
});

// ── 7. Event propagation via delegationStore ──────────────────────────────────

describe("Event propagation via delegationStore", () => {
  test("getEventBus returns undefined outside delegation context", () => {
    // Running outside any delegationStore.run() — should return undefined
    expect(getEventBus()).toBeUndefined();
  });

  test("getEventBus returns the bus set in delegationStore context", () => {
    const bus = new AgentEventBus();
    const delegCtx = { chain: [], depth: 0, events: bus };

    const retrieved = delegationStore.run(delegCtx, () => getEventBus());

    expect(retrieved).toBe(bus);
  });

  test("executeTask emits delegate:start and delegate:end on the bus", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "news");

    const bus = new AgentEventBus();
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));

    const delegCtx = { chain: [], depth: 0, events: bus };

    await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "news", "latest headlines")
    );

    expect(events).toContain(BUS_EVENTS.DELEGATE_START);
    expect(events).toContain(BUS_EVENTS.DELEGATE_END);
  });

  test("delegate:start event contains from, to, and query fields", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "finance");

    const bus = new AgentEventBus();
    const startEvents: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => {
      if (e.type === BUS_EVENTS.DELEGATE_START) {
        startEvents.push(e.data);
      }
    });

    const delegCtx = { chain: [], depth: 0, events: bus };

    await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "finance", "stock price")
    );

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].to).toBe("finance");
    expect(startEvents[0].query).toBe("stock price");
  });

  test("executeTask for unknown agent still does not emit delegate:start", async () => {
    const ctx = makeCtx();

    const bus = new AgentEventBus();
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));

    const delegCtx = { chain: [], depth: 0, events: bus };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "ghost-agent", "hello")
    );

    // Error should be returned but delegate:start should not have been emitted
    expect(result.result.response).toContain("Unknown agent");
    expect(events).not.toContain(BUS_EVENTS.DELEGATE_START);
  });
});

// ── 8. Multiple orchestrator support ─────────────────────────────────────────

describe("Multiple orchestrator support", () => {
  test("two orchestrators can be registered simultaneously", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    registerSpecialist(ctx, "news");

    createOrchestratorAgent(ctx, { name: "orch-1" });
    createOrchestratorAgent(ctx, { name: "orch-2" });

    const all = ctx.agents.list();
    const orchs = all.filter((a) => a.isOrchestrator);
    expect(orchs).toHaveLength(2);
    expect(orchs.map((o) => o.name).sort()).toEqual(["orch-1", "orch-2"]);
  });

  test("each orchestrator is prevented from being a delegation target", async () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");

    createOrchestratorAgent(ctx, { name: "orch-primary" });
    createOrchestratorAgent(ctx, { name: "orch-secondary" });

    // Attempt to delegate to orch-primary — should fail with orchestrator error
    const result = await executeTask(ctx, "orch-primary", "some query");
    expect(result.result.response).toContain("orchestrator");

    // Attempt to delegate to orch-secondary — same guard
    const result2 = await executeTask(ctx, "orch-secondary", "some query");
    expect(result2.result.response).toContain("orchestrator");
  });

  test("orchestrators scoped to different allowed agent sets", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "weather");
    registerSpecialist(ctx, "news");
    registerSpecialist(ctx, "finance");

    const orchWeather = createOrchestratorAgent(ctx, {
      name: "orch-weather",
      agents: ["weather"],
    });
    const orchNews = createOrchestratorAgent(ctx, {
      name: "orch-news",
      agents: ["news", "finance"],
    });

    expect(orchWeather.agents).toEqual(["weather"]);
    expect(orchNews.agents).toEqual(["news", "finance"]);
  });
});

// ── 9. Delegation depth enforcement ──────────────────────────────────────────

describe("Delegation depth enforcement", () => {
  test("custom maxDelegationDepth of 1 blocks second-level delegation", async () => {
    const ctx = makeCtx({ maxDelegationDepth: 1 });
    registerSpecialist(ctx, "level1");

    // Simulate being at depth 1 already — next call would be depth 1, which
    // meets the >= check for maxDelegationDepth of 1
    const delegCtx = { chain: ["orchestrator"], depth: 1 };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "level1", "query at depth limit")
    );

    expect(result.result.response).toContain("Delegation depth limit");
  });

  test("depth limit error message includes the delegation chain", async () => {
    const ctx = makeCtx({ maxDelegationDepth: 2 });
    registerSpecialist(ctx, "target");

    const delegCtx = {
      chain: ["orchestrator", "agent-a"],
      depth: 2,
    };

    const result = await delegationStore.run(delegCtx, () =>
      executeTask(ctx, "target", "deep query")
    );

    expect(result.result.response).toContain("orchestrator");
    expect(result.result.response).toContain("agent-a");
  });
});

// ── 10. AgentRegistry prompt helpers ─────────────────────────────────────────

describe("AgentRegistry prompt resolution", () => {
  test("getResolvedPrompt returns defaultSystem when no override", async () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "agent",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "Default prompt",
    });

    expect(await registry.getResolvedPrompt("agent")).toBe("Default prompt");
  });

  test("getResolvedPrompt returns override when set", async () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "agent",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "Default prompt",
    });

    registry.setPromptOverride("agent", "Custom override");
    expect(await registry.getResolvedPrompt("agent")).toBe("Custom override");
  });

  test("getResolvedPrompt returns undefined for unknown agent", async () => {
    const registry = new AgentRegistry();
    expect(await registry.getResolvedPrompt("nonexistent")).toBeUndefined();
  });

  test("resetPrompt restores default after override", async () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "agent",
      description: "test",
      toolNames: [],
      defaultFormat: "json",
      defaultSystem: "Default prompt",
    });

    registry.setPromptOverride("agent", "Override");
    expect(await registry.hasPromptOverride("agent")).toBe(true);

    registry.resetPrompt("agent");
    expect(await registry.hasPromptOverride("agent")).toBe(false);
    expect(await registry.getResolvedPrompt("agent")).toBe("Default prompt");
  });
});

// ── 11. Orchestrator registration returns correct structure ───────────────────

describe("createOrchestratorAgent return value", () => {
  test("returns an AgentRegistration object matching what was registered", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "specialist");

    const returned = createOrchestratorAgent(ctx, {
      name: "returned-orch",
      description: "Check return value",
    });

    const fromRegistry = ctx.agents.get("returned-orch");

    // Both references should describe the same agent
    expect(returned.name).toBe("returned-orch");
    expect(returned.name).toBe(fromRegistry!.name);
    expect(returned.isOrchestrator).toBe(true);
    expect(returned.isOrchestrator).toBe(fromRegistry!.isOrchestrator);
  });

  test("createOrchestrator with autonomous:false stores the flag implicitly (no error)", () => {
    const ctx = makeCtx();
    registerSpecialist(ctx, "specialist");

    // autonomous is an internal parameter; this should not throw
    expect(() =>
      createOrchestratorAgent(ctx, {
        name: "non-auto-orch",
        autonomous: false,
      })
    ).not.toThrow();

    const reg = ctx.agents.get("non-auto-orch");
    expect(reg).toBeDefined();
    expect(reg!.isOrchestrator).toBe(true);
  });
});
