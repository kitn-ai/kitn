import { describe, test, expect } from "bun:test";
import { VoiceManager } from "./voice-manager.js";
import type { VoiceProvider } from "./voice-provider.js";

function createMockProvider(name: string): VoiceProvider {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    async transcribe() { return { text: "hello" }; },
    async speak() { return new ReadableStream(); },
    async getSpeakers() { return [{ voiceId: "v1", name: "Test" }]; },
  };
}

describe("VoiceManager", () => {
  test("register and get provider", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    expect(mgr.get("openai")).toBeDefined();
    expect(mgr.get("openai")!.name).toBe("openai");
  });

  test("first registered is default", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    mgr.register(createMockProvider("groq"));
    expect(mgr.getDefault()).toBe("openai");
    expect(mgr.get()!.name).toBe("openai");
  });

  test("list providers", () => {
    const mgr = new VoiceManager();
    mgr.register(createMockProvider("openai"));
    mgr.register(createMockProvider("groq"));
    expect(mgr.listNames()).toEqual(["openai", "groq"]);
    expect(mgr.list()).toHaveLength(2);
  });

  test("isAvailable", () => {
    const mgr = new VoiceManager();
    expect(mgr.isAvailable()).toBe(false);
    mgr.register(createMockProvider("openai"));
    expect(mgr.isAvailable()).toBe(true);
  });
});
