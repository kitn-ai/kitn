/**
 * Hono-specific export verification tests.
 * Run with: bun test packages/hono/test/exports.test.ts
 */
import { describe, test, expect } from "bun:test";
import { createAIPlugin } from "../src/plugin.js";
import { toAgentRequest } from "../src/adapters/request-adapter.js";
import { AgentRegistry } from "../../core/src/registry/agent-registry.js";
import { ToolRegistry } from "../../core/src/registry/tool-registry.js";
import { createOrchestratorAgent } from "../../core/src/agents/orchestrator.js";

describe("@kitnai/hono-openapi exports", () => {
  test("exports createAIPlugin", () => {
    expect(createAIPlugin).toBeDefined();
  });
  test("exports toAgentRequest", () => {
    expect(toAgentRequest).toBeDefined();
  });
  test("re-exports core types", () => {
    // These should be re-exported from core
    expect(AgentRegistry).toBeDefined();
    expect(ToolRegistry).toBeDefined();
    expect(createOrchestratorAgent).toBeDefined();
  });
});
