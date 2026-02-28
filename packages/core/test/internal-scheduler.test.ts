import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import { ToolRegistry } from "../src/registry/tool-registry.js";
import { CardRegistry } from "../src/utils/card-registry.js";
import { createInternalScheduler } from "../src/crons/internal-scheduler.js";
import type { PluginContext } from "../src/types.js";

describe("InternalScheduler", () => {
  let ctx: PluginContext;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    const storage = createMemoryStorage();
    ctx = {
      agents: new AgentRegistry(),
      tools: new ToolRegistry(),
      storage,
      model: () => { throw new Error("No model"); },
      cards: new CardRegistry(),
      maxDelegationDepth: 3,
      defaultMaxSteps: 5,
      config: {} as any,
    };
  });

  afterEach(() => {
    stop?.();
  });

  test("creates a scheduler with start and stop", () => {
    const scheduler = createInternalScheduler(ctx);
    expect(scheduler.schedule).toBeDefined();
    expect(scheduler.unschedule).toBeDefined();
    expect(scheduler.start).toBeDefined();
    expect(scheduler.stop).toBeDefined();
  });

  test("schedule and unschedule are no-ops", async () => {
    const scheduler = createInternalScheduler(ctx);
    // Should not throw
    await scheduler.schedule({} as any, "/crons/test/run");
    await scheduler.unschedule("test-id");
  });

  test("tick processes due jobs", async () => {
    const scheduler = createInternalScheduler(ctx);

    // Create a due job
    const past = new Date(Date.now() - 60_000).toISOString();
    await ctx.storage.crons.create({
      name: "test-job",
      description: "test",
      schedule: "* * * * *",
      agentName: "nonexistent",
      input: "hello",
      enabled: true,
      nextRun: past,
    });

    // Manually trigger tick
    await scheduler.tick();

    // Should have created an execution record
    const jobs = await ctx.storage.crons.list();
    const history = await ctx.storage.crons.listExecutions(jobs[0].id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("failed"); // agent doesn't exist, so it fails
  });
});
