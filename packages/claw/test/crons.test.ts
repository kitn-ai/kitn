import { describe, test, expect } from "bun:test";
import { setupCronScheduler } from "../src/crons/setup.js";
import { createClawPlugin } from "../src/gateway/create-plugin.js";
import type { ClawConfig } from "../src/config/schema.js";

/** Minimal config for testing — only the fields needed to create a plugin. */
const testConfig: ClawConfig = {
  model: "test-model",
  provider: { type: "openai", apiKey: "test-key" },
  channels: {},
  permissions: { profile: "strict" },
  gateway: { port: 0, bind: "local" },
  users: {},
};

describe("setupCronScheduler", () => {
  test("returns a scheduler with start/stop/tick methods", () => {
    const plugin = createClawPlugin(testConfig);
    const scheduler = setupCronScheduler(plugin);

    expect(typeof scheduler.start).toBe("function");
    expect(typeof scheduler.stop).toBe("function");
    expect(typeof scheduler.tick).toBe("function");
    expect(typeof scheduler.schedule).toBe("function");
    expect(typeof scheduler.unschedule).toBe("function");
  });

  test("tick() with no due jobs does nothing", async () => {
    const plugin = createClawPlugin(testConfig);
    const scheduler = setupCronScheduler(plugin);

    // Should not throw even when there are no jobs
    await scheduler.tick();
  });

  test("start() and stop() control the tick loop", () => {
    const plugin = createClawPlugin(testConfig);
    const scheduler = setupCronScheduler(plugin);

    // start should not throw
    scheduler.start();

    // calling start again should be a no-op (idempotent)
    scheduler.start();

    // stop should not throw
    scheduler.stop();

    // calling stop again should be a no-op (idempotent)
    scheduler.stop();
  });
});
