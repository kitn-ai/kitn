import { describe, test, expect } from "bun:test";
import { createLifecycleHooks } from "./lifecycle-hooks.js";
import type {
  AgentStartEvent,
  ToolExecuteEvent,
  WildcardEvent,
} from "./lifecycle-hooks.js";

describe("LifecycleHookEmitter", () => {
  test("subscribes and receives events", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const received: AgentStartEvent[] = [];

    hooks.on("agent:start", (data) => {
      received.push(data);
    });

    const event: AgentStartEvent = {
      agentName: "test-agent",
      input: "hello",
      conversationId: "conv-1",
      timestamp: Date.now(),
    };

    hooks.emit("agent:start", event);

    expect(received).toHaveLength(1);
    expect(received[0].agentName).toBe("test-agent");
    expect(received[0].input).toBe("hello");
    expect(received[0].conversationId).toBe("conv-1");
  });

  test("unsubscribes correctly", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const received: AgentStartEvent[] = [];

    const unsub = hooks.on("agent:start", (data) => {
      received.push(data);
    });

    hooks.emit("agent:start", {
      agentName: "a1",
      input: "x",
      conversationId: "c1",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);

    unsub();

    hooks.emit("agent:start", {
      agentName: "a2",
      input: "y",
      conversationId: "c2",
      timestamp: Date.now(),
    });

    // Should still be 1 — handler was removed
    expect(received).toHaveLength(1);
  });

  test("wildcard receives all events with type field", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const received: WildcardEvent[] = [];

    hooks.on("*", (data) => {
      received.push(data);
    });

    hooks.emit("agent:start", {
      agentName: "a1",
      input: "x",
      conversationId: "c1",
      timestamp: Date.now(),
    });

    hooks.emit("agent:end", {
      agentName: "a1",
      input: "x",
      output: "result",
      toolsUsed: ["tool1"],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      duration: 100,
      conversationId: "c1",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("agent:start");
    expect(received[1].type).toBe("agent:end");
    // Verify the original data is present
    expect((received[0] as WildcardEvent & { agentName: string }).agentName).toBe("a1");
  });

  test("handler errors do not propagate", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const received: AgentStartEvent[] = [];

    // First handler throws
    hooks.on("agent:start", () => {
      throw new Error("handler blew up");
    });

    // Second handler should still run
    hooks.on("agent:start", (data) => {
      received.push(data);
    });

    // Should not throw
    hooks.emit("agent:start", {
      agentName: "a1",
      input: "x",
      conversationId: "c1",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].agentName).toBe("a1");
  });

  test("trace events only fire at trace level", () => {
    const summaryHooks = createLifecycleHooks({ level: "summary" });
    const traceHooks = createLifecycleHooks({ level: "trace" });

    const summaryReceived: ToolExecuteEvent[] = [];
    const traceReceived: ToolExecuteEvent[] = [];

    summaryHooks.on("tool:execute", (data) => {
      summaryReceived.push(data);
    });

    traceHooks.on("tool:execute", (data) => {
      traceReceived.push(data);
    });

    const toolEvent: ToolExecuteEvent = {
      agentName: "a1",
      toolName: "search",
      input: { query: "test" },
      output: { results: [] },
      duration: 50,
      conversationId: "c1",
      timestamp: Date.now(),
    };

    summaryHooks.emit("tool:execute", toolEvent);
    traceHooks.emit("tool:execute", toolEvent);

    // Summary level should skip trace events
    expect(summaryReceived).toHaveLength(0);
    // Trace level should fire them
    expect(traceReceived).toHaveLength(1);
    expect(traceReceived[0].toolName).toBe("search");
  });

  test("summary events fire at both levels", () => {
    const summaryHooks = createLifecycleHooks({ level: "summary" });
    const traceHooks = createLifecycleHooks({ level: "trace" });

    const summaryReceived: AgentStartEvent[] = [];
    const traceReceived: AgentStartEvent[] = [];

    summaryHooks.on("agent:start", (data) => {
      summaryReceived.push(data);
    });

    traceHooks.on("agent:start", (data) => {
      traceReceived.push(data);
    });

    const agentEvent: AgentStartEvent = {
      agentName: "a1",
      input: "hello",
      conversationId: "c1",
      timestamp: Date.now(),
    };

    summaryHooks.emit("agent:start", agentEvent);
    traceHooks.emit("agent:start", agentEvent);

    expect(summaryReceived).toHaveLength(1);
    expect(traceReceived).toHaveLength(1);
  });

  test("wildcard also skips trace events at summary level", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const received: WildcardEvent[] = [];

    hooks.on("*", (data) => {
      received.push(data);
    });

    hooks.emit("agent:start", {
      agentName: "a1",
      input: "x",
      conversationId: "c1",
      timestamp: Date.now(),
    });

    hooks.emit("tool:execute", {
      agentName: "a1",
      toolName: "search",
      input: {},
      output: null,
      duration: 10,
      conversationId: "c1",
      timestamp: Date.now(),
    });

    // Only the summary event should come through
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent:start");
  });
});
