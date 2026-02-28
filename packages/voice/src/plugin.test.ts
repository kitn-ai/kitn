import { describe, test, expect } from "bun:test";
import { createVoice } from "./plugin.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() {
      return { text: "hello" };
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
      return [{ voiceId: "v1", name: "Test" }];
    },
  };
}

describe("createVoice", () => {
  test("returns a valid KitnPlugin", () => {
    const plugin = createVoice({ providers: [createMockProvider("openai")] });
    expect(plugin.name).toBe("voice");
    expect(plugin.prefix).toBe("/voice");
    expect(plugin.routes.length).toBeGreaterThan(0);
  });

  test("routes are functional", async () => {
    const plugin = createVoice({ providers: [createMockProvider("openai")] });
    const speakersRoute = plugin.routes.find((r) => r.path === "/speakers");
    const res = await speakersRoute!.handler({
      request: new Request("http://localhost/speakers"),
      params: {},
      pluginContext: {} as any,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.speakers).toHaveLength(1);
  });

  test("works without optional config", () => {
    const plugin = createVoice({ providers: [createMockProvider("openai")] });
    expect(plugin.name).toBe("voice");
  });

  test("registers multiple providers", async () => {
    const plugin = createVoice({
      providers: [createMockProvider("openai"), createMockProvider("elevenlabs")],
    });
    const providersRoute = plugin.routes.find((r) => r.path === "/providers");
    const res = await providersRoute!.handler({
      request: new Request("http://localhost/providers"),
      params: {},
      pluginContext: {} as any,
    });
    const data = await res.json();
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0].isDefault).toBe(true);
    expect(data.providers[1].isDefault).toBe(false);
  });

  test("uses custom audioStore when provided", async () => {
    let saveCalled = false;
    const customStore = {
      async saveAudio() {
        saveCalled = true;
        return { id: "custom-1", mimeType: "audio/mpeg", size: 3, createdAt: new Date().toISOString() };
      },
      async getAudio() { return null; },
      async deleteAudio() { return false; },
      async listAudio() { return []; },
      async cleanupOlderThan() { return 0; },
    };
    const plugin = createVoice({
      providers: [createMockProvider("openai")],
      audioStore: customStore,
    });
    // Trigger speak with save to verify custom store is used
    const speakRoute = plugin.routes.find((r) => r.path === "/speak");
    const req = new Request("http://localhost/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test", save: true }),
    });
    await speakRoute!.handler({ request: req, params: {}, pluginContext: {} as any });
    expect(saveCalled).toBe(true);
  });
});
