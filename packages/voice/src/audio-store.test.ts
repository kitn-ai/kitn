import { describe, test, expect } from "bun:test";
import { createMemoryAudioStore } from "./audio-store-memory.js";

describe("AudioStore (in-memory)", () => {
  test("save and retrieve audio", async () => {
    const store = createMemoryAudioStore();
    const buffer = Buffer.from("fake audio data");
    const entry = await store.saveAudio(buffer, "audio/mp3");
    expect(entry.id).toBeDefined();
    expect(entry.mimeType).toBe("audio/mp3");
    expect(entry.size).toBe(buffer.length);
    const result = await store.getAudio(entry.id);
    expect(result).not.toBeNull();
    expect(result!.data.toString()).toBe("fake audio data");
  });

  test("delete audio", async () => {
    const store = createMemoryAudioStore();
    const entry = await store.saveAudio(Buffer.from("data"), "audio/mp3");
    expect(await store.deleteAudio(entry.id)).toBe(true);
    expect(await store.getAudio(entry.id)).toBeNull();
  });

  test("list audio", async () => {
    const store = createMemoryAudioStore();
    await store.saveAudio(Buffer.from("a"), "audio/mp3");
    await store.saveAudio(Buffer.from("b"), "audio/mp3");
    const entries = await store.listAudio();
    expect(entries).toHaveLength(2);
  });

  test("scope isolation", async () => {
    const store = createMemoryAudioStore();
    await store.saveAudio(Buffer.from("a"), "audio/mp3", undefined, "user1");
    await store.saveAudio(Buffer.from("b"), "audio/mp3", undefined, "user2");
    expect(await store.listAudio("user1")).toHaveLength(1);
    expect(await store.listAudio("user2")).toHaveLength(1);
  });
});
