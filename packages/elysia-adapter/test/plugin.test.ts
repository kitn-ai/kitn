import { describe, test, expect } from "bun:test";
import { createAIPlugin } from "../src/plugin.js";
import { createMemoryStorage } from "@kitnai/core";

describe("createAIPlugin", () => {
  test("returns a plugin instance with an Elysia router", () => {
    const plugin = createAIPlugin({
      storage: createMemoryStorage(),
    });

    expect(plugin.router).toBeDefined();
    expect(plugin.agents).toBeDefined();
    expect(plugin.tools).toBeDefined();
    expect(plugin.storage).toBeDefined();
    expect(plugin.createHandlers).toBeFunction();
    expect(plugin.createOrchestrator).toBeFunction();
  });

  test("uses in-memory storage when none provided", () => {
    const plugin = createAIPlugin({});
    expect(plugin.storage).toBeDefined();
    expect(plugin.storage.memory).toBeDefined();
  });
});
