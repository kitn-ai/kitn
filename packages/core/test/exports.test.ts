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
import { getNextRun, validateCron } from "../src/crons/cron-parser.js";
import { executeCronJob } from "../src/crons/execute-cron.js";
import { createInternalScheduler } from "../src/crons/internal-scheduler.js";
import type { CronJob, CronExecution, CronStore } from "../src/storage/interfaces.js";
import type { CronScheduler } from "../src/crons/scheduler.js";

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
  test("exports cron utilities", () => {
    expect(getNextRun).toBeDefined();
    expect(typeof getNextRun).toBe("function");
    expect(validateCron).toBeDefined();
    expect(typeof validateCron).toBe("function");
    expect(executeCronJob).toBeDefined();
    expect(typeof executeCronJob).toBe("function");
    expect(createInternalScheduler).toBeDefined();
    expect(typeof createInternalScheduler).toBe("function");
  });
  test("exports cron types (compile-time check)", () => {
    // Type-only imports are verified at compile time.
    // This test ensures the type symbols resolve without error.
    const _cronJob: CronJob | undefined = undefined;
    const _cronExecution: CronExecution | undefined = undefined;
    const _cronStore: CronStore | undefined = undefined;
    const _cronScheduler: CronScheduler | undefined = undefined;
    expect(_cronJob).toBeUndefined();
    expect(_cronExecution).toBeUndefined();
    expect(_cronStore).toBeUndefined();
    expect(_cronScheduler).toBeUndefined();
  });
});
