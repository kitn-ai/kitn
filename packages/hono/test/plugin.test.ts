/**
 * Plugin creation, registration, and initialization tests.
 * Run with: bun test packages/ai/test/plugin.test.ts
 */
import { describe, test, expect, afterAll } from "bun:test";
import { createAIPlugin } from "@kitnai/hono";
import { createFileStorage, CardRegistry } from "@kitnai/core";
import { makeMockModel } from "./helpers.js";
import { tool } from "ai";
import { z } from "zod";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

let tmpDir: string;
let ai: ReturnType<typeof createAIPlugin>;

describe("createAIPlugin", () => {
  test("returns a valid plugin instance", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ai-test-"));

    ai = createAIPlugin({
      model: makeMockModel as any,
      storage: createFileStorage({ dataDir: tmpDir }),
    });

    expect(ai).toBeDefined();
    expect(ai.router).toBeDefined();
    expect(ai.agents).toBeDefined();
    expect(ai.tools).toBeDefined();
    expect(ai.cards).toBeDefined();
    expect(ai.cards).toBeInstanceOf(CardRegistry);
  });

  test("registers a tool", () => {
    const greetTool = tool({
      description: "Greet someone",
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });

    ai.tools.register({
      name: "greet",
      description: "Greet someone",
      inputSchema: z.object({ name: z.string() }),
      tool: greetTool,
      category: "test",
    });

    expect(ai.tools.list()).toHaveLength(1);
    expect(ai.tools.get("greet")).toBeDefined();
  });

  test("registers an agent", () => {
    const greetTool = tool({
      description: "Greet someone",
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });

    ai.agents.register({
      name: "test-agent",
      description: "A test agent",
      toolNames: ["greet"],
      defaultFormat: "json",
      defaultSystem: "You are a test agent.",
      tools: { greet: greetTool },
    });

    expect(ai.agents.list()).toHaveLength(1);
    expect(ai.agents.get("test-agent")).toBeDefined();
  });

});

describe("Agent guard hook", () => {
  test("guard blocks when returning allowed: false", () => {
    ai.agents.register({
      name: "guarded-agent",
      description: "An agent with a guard",
      toolNames: ["greet"],
      defaultFormat: "json",
      defaultSystem: "You are a guarded agent.",
      tools: {
        greet: tool({
          description: "Greet",
          parameters: z.object({ name: z.string() }),
          execute: async ({ name }) => `Hi ${name}`,
        }),
      },
      guard: (query) => {
        if (query.includes("blocked")) return { allowed: false, reason: "Query contains blocked content" };
        return { allowed: true };
      },
    });

    const reg = ai.agents.get("guarded-agent");
    expect(reg).toBeDefined();
    expect(reg!.guard).toBeFunction();

    const blockResult = reg!.guard!("this is blocked content", "guarded-agent");
    expect(blockResult).toEqual({ allowed: false, reason: "Query contains blocked content" });
  });

  test("guard allows when returning allowed: true", () => {
    const reg = ai.agents.get("guarded-agent");
    const allowResult = reg!.guard!("normal query", "guarded-agent");
    expect(allowResult).toEqual({ allowed: true });
  });
});

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});
