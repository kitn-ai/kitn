import { describe, test, expect } from "bun:test";

const SERVICE_URL = process.env.KITN_CHAT_URL ?? "http://localhost:4002";
const HAS_API_KEY = !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);

describe.skipIf(!HAS_API_KEY)("chat service integration", () => {
  test("returns a plan for a valid request", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I want a weather agent",
        metadata: {
          registryIndex: [
            { name: "weather-tool", type: "kitn:tool", description: "Weather data from Open-Meteo" },
            { name: "weather-agent", type: "kitn:agent", description: "Weather specialist agent", registryDependencies: ["weather-tool"] },
          ],
          installed: ["core", "hono"],
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.plan).toBeDefined();
    expect(data.plan.summary).toBeDefined();
    expect(data.plan.steps).toBeInstanceOf(Array);
    expect(data.plan.steps.length).toBeGreaterThan(0);

    const actions = data.plan.steps.map((s: any) => s.action);
    expect(actions).toContain("add");
  });

  test("rejects off-topic requests", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Write me a poem about cats",
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.rejected).toBe(true);
    expect(data.message).toBeDefined();
  });

  test("handles missing message gracefully", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("health check works", async () => {
    const res = await fetch(`${SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
