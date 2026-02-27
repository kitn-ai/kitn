/**
 * HTTP route endpoint tests.
 * Run with: bun test packages/ai/test/routes.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createAIPlugin } from "@kitnai/hono-openapi";
import { createFileStorage } from "@kitnai/core";
import { makeMockModel } from "./helpers.js";
import { Hono } from "hono";
import { tool } from "ai";
import { z } from "zod";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

let tmpDir: string;
let app: Hono;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ai-routes-test-"));

  const ai = createAIPlugin({
    model: makeMockModel as any,
    storage: createFileStorage({ dataDir: tmpDir }),
  });

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

  ai.agents.register({
    name: "test-agent",
    description: "A test agent",
    toolNames: ["greet"],
    defaultFormat: "json",
    defaultSystem: "You are a test agent.",
    tools: { greet: greetTool },
  });

  await ai.initialize();

  app = new Hono();
  app.route("/ai", ai.router);
});

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe("Agent endpoints", () => {
  test("GET /agents returns registered agents", async () => {
    const res = await app.request("/ai/agents");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.count).toBe(1);
    expect(body.agents[0].name).toBe("test-agent");
    expect(body.agents[0].toolNames).toEqual(["greet"]);
  });

  test("GET /agents/:name returns agent details", async () => {
    const res = await app.request("/ai/agents/test-agent");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe("test-agent");
    expect(body.systemPrompt).toBe("You are a test agent.");
    expect(body.isDefault).toBe(true);
  });
});

describe("Tool endpoints", () => {
  test("GET /tools returns registered tools", async () => {
    const res = await app.request("/ai/tools");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.count).toBe(1);
    expect(body.tools[0].name).toBe("greet");
  });
});

describe("Memory endpoints", () => {
  test("GET /memory returns empty namespaces initially", async () => {
    const res = await app.request("/ai/memory");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.namespaces).toEqual([]);
  });
});

describe("Conversation endpoints", () => {
  test("GET /conversations returns empty initially", async () => {
    const res = await app.request("/ai/conversations");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.conversations).toEqual([]);
  });
});

describe("Unknown routes", () => {
  test("returns 404 for nonexistent path", async () => {
    const res = await app.request("/ai/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("Voice routes", () => {
  test("not mounted when voice not configured", async () => {
    const res = await app.request("/ai/voice/speakers");
    expect(res.status).toBe(404);
  });
});
