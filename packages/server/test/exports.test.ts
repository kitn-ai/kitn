/**
 * Constant and type export verification tests.
 * Run with: bun test packages/ai/test/exports.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  SSE_EVENTS,
  BUS_EVENTS,
  BUS_TO_SSE_MAP,
  FORWARDED_BUS_EVENTS,
  STATUS_CODES,
  TOOL_NAMES,
  DEFAULTS,
  DEFAULT_ORCHESTRATOR_PROMPT,
} from "../src/index.js";

describe("SSE_EVENTS", () => {
  test("core streaming events", () => {
    expect(SSE_EVENTS.TEXT_DELTA).toBe("text-delta");
    expect(SSE_EVENTS.DONE).toBe("done");
    expect(SSE_EVENTS.ERROR).toBe("error");
    expect(SSE_EVENTS.SESSION_START).toBe("session:start");
    expect(SSE_EVENTS.STATUS).toBe("status");
  });
});

describe("BUS_EVENTS", () => {
  test("delegation and tool events", () => {
    expect(BUS_EVENTS.TOOL_CALL).toBe("tool:call");
    expect(BUS_EVENTS.DELEGATE_START).toBe("delegate:start");
    expect(BUS_EVENTS.STATUS).toBe("status");
  });
});

describe("BUS_TO_SSE_MAP and FORWARDED_BUS_EVENTS", () => {
  test("status event is wired through bus-to-SSE pipeline", () => {
    expect(BUS_TO_SSE_MAP["status"]).toBe("status");
    expect(FORWARDED_BUS_EVENTS.has("status")).toBe(true);
  });
});

describe("TOOL_NAMES", () => {
  test("built-in tool names without underscore prefix", () => {
    expect(TOOL_NAMES.ROUTE_TO_AGENT).toBe("routeToAgent");
    expect(TOOL_NAMES.CREATE_TASK).toBe("createTask");
    expect(TOOL_NAMES.CLARIFY).toBe("clarify");
    expect(TOOL_NAMES.MEMORY).toBe("memory");
  });
});

describe("DEFAULTS", () => {
  test("delegation and agent defaults", () => {
    expect(DEFAULTS.MAX_DELEGATION_DEPTH).toBe(3);
    expect(DEFAULTS.MAX_STEPS).toBe(5);
    expect(DEFAULTS.SUMMARY_LENGTH_LIMIT).toBe(200);
  });

  test("compaction defaults", () => {
    expect(DEFAULTS.COMPACTION_THRESHOLD).toBe(20);
    expect(DEFAULTS.COMPACTION_PRESERVE_RECENT).toBe(4);
  });
});

describe("STATUS_CODES", () => {
  test("exports all 10 status codes", () => {
    expect(STATUS_CODES.THINKING).toBe("thinking");
    expect(STATUS_CODES.PLANNING).toBe("planning");
    expect(STATUS_CODES.EXECUTING_TASKS).toBe("executing-tasks");
    expect(STATUS_CODES.SYNTHESIZING).toBe("synthesizing");
    expect(STATUS_CODES.COMPACTING).toBe("compacting");
    expect(STATUS_CODES.RETRYING).toBe("retrying");
    expect(STATUS_CODES.FALLBACK).toBe("fallback");
    expect(STATUS_CODES.GUARD_CHECK).toBe("guard-check");
    expect(STATUS_CODES.LOADING_CONTEXT).toBe("loading-context");
    expect(STATUS_CODES.PROCESSING).toBe("processing");
    expect(Object.keys(STATUS_CODES)).toHaveLength(10);
  });
});

describe("DEFAULT_ORCHESTRATOR_PROMPT", () => {
  test("is a non-empty string containing orchestrator instructions", () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toBeString();
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain("orchestrator");
  });
});
