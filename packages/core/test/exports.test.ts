/**
 * Core export verification tests.
 * Run with: bun test packages/core/test/exports.test.ts
 */
import { describe, test, expect } from "bun:test";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import { ToolRegistry } from "../src/registry/tool-registry.js";
import { createOrchestratorAgent } from "../src/agents/orchestrator.js";
import { createSSEStream } from "../src/streaming/sse-writer.js";
import { createFileStorage } from "../src/storage/file-storage/index.js";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";
import { AgentEventBus } from "../src/events/agent-events.js";
import { SSE_EVENTS, BUS_EVENTS } from "../src/events/events.js";
import { streamAgentResponse } from "../src/streaming/stream-helpers.js";

describe("@kitnai/core exports", () => {
  test("exports AgentRegistry class", () => {
    expect(AgentRegistry).toBeDefined();
  });
  test("exports ToolRegistry class", () => {
    expect(ToolRegistry).toBeDefined();
  });
  test("exports createOrchestratorAgent", () => {
    expect(createOrchestratorAgent).toBeDefined();
  });
  test("exports createSSEStream", () => {
    expect(createSSEStream).toBeDefined();
  });
  test("exports storage factories", () => {
    expect(createFileStorage).toBeDefined();
    expect(createMemoryStorage).toBeDefined();
  });
  test("exports event utilities", () => {
    expect(AgentEventBus).toBeDefined();
    expect(SSE_EVENTS).toBeDefined();
    expect(BUS_EVENTS).toBeDefined();
  });
  test("exports streaming utilities", () => {
    expect(streamAgentResponse).toBeDefined();
  });
});
