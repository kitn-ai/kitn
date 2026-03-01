import { describe, test, expect } from "bun:test";

const SERVICE_URL = process.env.KITN_CHAT_URL ?? "http://localhost:4002";
const HAS_API_KEY = !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);

describe.skipIf(!HAS_API_KEY)("chat service integration", () => {
  // LLM calls can take a while
  const TIMEOUT = 30_000;

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
  }, TIMEOUT);

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

  test("prefers add over create when component exists in unconfigured registry", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I want a sentiment tool",
        metadata: {
          registryIndex: [
            { name: "weather-tool", type: "kitn:tool", description: "Weather data from Open-Meteo" },
          ],
          installed: [],
          globalRegistryIndex: [
            {
              namespace: "@community",
              url: "https://community.example.com/r/{type}/{name}.json",
              items: [
                { name: "sentiment-tool", type: "kitn:tool", description: "Analyze text sentiment using AI" },
              ],
            },
          ],
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.plan).toBeDefined();

    const actions = data.plan.steps.map((s: any) => s.action);
    expect(actions).toContain("registry-add");
    expect(actions).toContain("add");
    expect(actions).not.toContain("create");

    const registryStep = data.plan.steps.find((s: any) => s.action === "registry-add");
    expect(registryStep.namespace).toBe("@community");
    expect(registryStep.url).toContain("{type}");
  }, TIMEOUT);

  test("falls back to create when nothing matches in any registry", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I need a tool that checks my database for duplicate entries",
        metadata: {
          registryIndex: [
            { name: "weather-tool", type: "kitn:tool", description: "Weather data from Open-Meteo" },
          ],
          installed: [],
          globalRegistryIndex: [],
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.plan).toBeDefined();

    const actions = data.plan.steps.map((s: any) => s.action);
    expect(actions).toContain("create");
    expect(actions).not.toContain("registry-add");
  }, TIMEOUT);

  test("health check works", async () => {
    const res = await fetch(`${SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
