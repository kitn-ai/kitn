import { describe, test, expect, beforeEach } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import { ToolRegistry } from "../src/registry/tool-registry.js";
import { CardRegistry } from "../src/utils/card-registry.js";
import type { PluginContext } from "../src/types.js";

describe("executeCronJob", () => {
  let ctx: PluginContext;

  beforeEach(() => {
    const storage = createMemoryStorage();
    const agents = new AgentRegistry();
    const tools = new ToolRegistry();
    const cards = new CardRegistry();

    ctx = {
      agents,
      tools,
      storage,
      model: () => { throw new Error("No model"); },
      cards,
      maxDelegationDepth: 3,
      defaultMaxSteps: 5,
      config: {} as any,
    };
  });

  test("marks execution as failed when agent not found", async () => {
    const { executeCronJob } = await import("../src/crons/execute-cron.js");

    const job = await ctx.storage.crons.create({
      name: "test",
      description: "test",
      schedule: "0 6 * * *",
      agentName: "nonexistent-agent",
      input: "Hello",
      enabled: true,
    });

    const execution = await executeCronJob(ctx, job);
    expect(execution.status).toBe("failed");
    expect(execution.error).toContain("not found");
  });

  test("updates lastRun on the job after execution", async () => {
    const { executeCronJob } = await import("../src/crons/execute-cron.js");

    const job = await ctx.storage.crons.create({
      name: "test",
      description: "test",
      schedule: "0 6 * * *",
      agentName: "nonexistent-agent",
      input: "Hello",
      enabled: true,
    });

    await executeCronJob(ctx, job);

    const updated = await ctx.storage.crons.get(job.id);
    expect(updated!.lastRun).toBeDefined();
  });

  test("disables one-off job after execution", async () => {
    const { executeCronJob } = await import("../src/crons/execute-cron.js");

    const job = await ctx.storage.crons.create({
      name: "one-off",
      description: "test",
      runAt: new Date().toISOString(),
      agentName: "nonexistent-agent",
      input: "Hello",
      enabled: true,
    });

    await executeCronJob(ctx, job);

    const updated = await ctx.storage.crons.get(job.id);
    expect(updated!.enabled).toBe(false);
  });
});
