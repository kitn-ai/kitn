import { describe, test, expect } from "bun:test";
import { createVoiceRoutes } from "./routes.js";
import { VoiceManager } from "./voice-manager.js";
import { createMemoryAudioStore } from "./audio-store-memory.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() {
      return { text: "hello world" };
    },
    async speak() {
      return new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      });
    },
    async getSpeakers() {
      return [{ voiceId: "alloy", name: "Alloy" }];
    },
  };
}

describe("Voice routes", () => {
  const mgr = new VoiceManager();
  mgr.register(createMockProvider("openai"));
  const audioStore = createMemoryAudioStore();
  const routes = createVoiceRoutes({ voiceManager: mgr, audioStore });

  test("creates all 8 routes", () => {
    expect(routes).toHaveLength(8);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /speakers",
      "GET /providers",
      "POST /transcribe",
      "POST /speak",
      "POST /converse",
      "GET /audio",
      "GET /audio/:id",
      "DELETE /audio/:id",
    ]);
  });

  test("GET /speakers returns speakers", async () => {
    const handler = routes.find((r) => r.path === "/speakers")!.handler;
    const res = await handler({
      request: new Request("http://localhost/speakers"),
      params: {},
      pluginContext: {} as any,
    });
    const data = await res.json();
    expect(data.speakers).toHaveLength(1);
    expect(data.speakers[0].name).toBe("Alloy");
    expect(data.provider).toBe("openai");
  });

  test("GET /providers returns providers", async () => {
    const handler = routes.find((r) => r.path === "/providers")!.handler;
    const res = await handler({
      request: new Request("http://localhost/providers"),
      params: {},
      pluginContext: {} as any,
    });
    const data = await res.json();
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0].name).toBe("openai");
    expect(data.providers[0].isDefault).toBe(true);
  });

  test("POST /speak returns audio stream", async () => {
    const handler = routes.find((r) => r.path === "/speak")!.handler;
    const req = new Request("http://localhost/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    const res = await handler({
      request: req,
      params: {},
      pluginContext: {} as any,
    });
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });

  test("POST /speak with save buffers and returns audio with X-Audio-Id", async () => {
    const handler = routes.find((r) => r.path === "/speak")!.handler;
    const req = new Request("http://localhost/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello", save: true }),
    });
    const res = await handler({
      request: req,
      params: {},
      pluginContext: {} as any,
    });
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Audio-Id")).toBeTruthy();
  });

  test("GET /audio lists entries", async () => {
    const handler = routes.find((r) => r.path === "/audio" && r.method === "GET")!.handler;
    const res = await handler({
      request: new Request("http://localhost/audio"),
      params: {},
      pluginContext: {} as any,
    });
    const data = await res.json();
    expect(data.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.entries)).toBe(true);
  });

  test("GET /audio/:id returns 404 for missing audio", async () => {
    const handler = routes.find((r) => r.path === "/audio/:id" && r.method === "GET")!.handler;
    const res = await handler({
      request: new Request("http://localhost/audio/nonexistent"),
      params: { id: "nonexistent" },
      pluginContext: {} as any,
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /audio/:id returns deleted status", async () => {
    const handler = routes.find((r) => r.path === "/audio/:id" && r.method === "DELETE")!.handler;
    const res = await handler({
      request: new Request("http://localhost/audio/nonexistent", { method: "DELETE" }),
      params: { id: "nonexistent" },
      pluginContext: {} as any,
    });
    const data = await res.json();
    expect(data.deleted).toBe(false);
  });

  test("all routes have schema metadata", () => {
    for (const route of routes) {
      expect(route.schema).toBeDefined();
      expect(route.schema!.summary).toBeTruthy();
      expect(route.schema!.tags).toEqual(["Voice"]);
    }
  });
});
