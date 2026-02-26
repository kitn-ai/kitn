import { describe, test, expect } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";

describe("scoped storage", () => {
  describe("ConversationStore", () => {
    test("list with scopeId returns only scoped conversations", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      await storage.conversations.append("conv-2", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-b");

      const userA = await storage.conversations.list("user-a");
      expect(userA).toHaveLength(1);
      expect(userA[0].id).toBe("conv-1");
    });

    test("list without scopeId returns all", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      await storage.conversations.append("conv-2", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-b");

      const all = await storage.conversations.list();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    test("get with scopeId retrieves scoped conversation", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hello", timestamp: new Date().toISOString() }, "user-a");

      const conv = await storage.conversations.get("conv-1", "user-a");
      expect(conv).not.toBeNull();
      expect(conv!.messages[0].content).toBe("hello");
    });

    test("get without scopeId retrieves any conversation", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hello", timestamp: new Date().toISOString() }, "user-a");

      const conv = await storage.conversations.get("conv-1");
      expect(conv).not.toBeNull();
    });

    test("create with scopeId scopes the conversation", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.create("conv-1", "user-a");

      const scoped = await storage.conversations.list("user-a");
      expect(scoped).toHaveLength(1);
    });

    test("delete with scopeId removes scoped conversation", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      await storage.conversations.delete("conv-1", "user-a");

      const scoped = await storage.conversations.list("user-a");
      expect(scoped).toHaveLength(0);
    });

    test("clear with scopeId clears scoped conversation", async () => {
      const storage = createMemoryStorage();
      await storage.conversations.append("conv-1", { role: "user", content: "hi", timestamp: new Date().toISOString() }, "user-a");
      const cleared = await storage.conversations.clear("conv-1", "user-a");
      expect(cleared.messages).toHaveLength(0);
    });
  });

  describe("MemoryStore", () => {
    test("scoped memory entries are isolated", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "value-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key", "value-b", undefined, "user-b");

      const entriesA = await storage.memory.listEntries("ns", "user-a");
      expect(entriesA).toHaveLength(1);
      expect(entriesA[0].value).toBe("value-a");
    });

    test("listEntries without scopeId returns all", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key-a", "value-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key-b", "value-b", undefined, "user-b");

      const all = await storage.memory.listEntries("ns");
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    test("listNamespaces with scopeId returns only scoped namespaces", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns-a", "key", "val", undefined, "user-a");
      await storage.memory.saveEntry("ns-b", "key", "val", undefined, "user-b");

      const nsA = await storage.memory.listNamespaces("user-a");
      expect(nsA).toHaveLength(1);
      expect(nsA[0]).toBe("ns-a");
    });

    test("getEntry with scopeId retrieves scoped entry", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "scoped-val", undefined, "user-a");

      const entry = await storage.memory.getEntry("ns", "key", "user-a");
      expect(entry).not.toBeNull();
      expect(entry!.value).toBe("scoped-val");
    });

    test("deleteEntry with scopeId deletes only scoped entry", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "val-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key", "val-b", undefined, "user-b");

      await storage.memory.deleteEntry("ns", "key", "user-a");

      const entryA = await storage.memory.getEntry("ns", "key", "user-a");
      const entryB = await storage.memory.getEntry("ns", "key", "user-b");
      expect(entryA).toBeNull();
      expect(entryB).not.toBeNull();
    });

    test("clearNamespace with scopeId clears only scoped namespace", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "val-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key", "val-b", undefined, "user-b");

      await storage.memory.clearNamespace("ns", "user-a");

      const entriesA = await storage.memory.listEntries("ns", "user-a");
      const entriesB = await storage.memory.listEntries("ns", "user-b");
      expect(entriesA).toHaveLength(0);
      expect(entriesB).toHaveLength(1);
    });

    test("loadMemoriesForIds with scopeId loads only scoped entries", async () => {
      const storage = createMemoryStorage();
      await storage.memory.saveEntry("ns", "key", "val-a", undefined, "user-a");
      await storage.memory.saveEntry("ns", "key", "val-b", undefined, "user-b");

      const memories = await storage.memory.loadMemoriesForIds(["ns"], "user-a");
      expect(memories).toHaveLength(1);
      expect(memories[0].value).toBe("val-a");
    });
  });

  describe("AudioStore", () => {
    test("scoped audio entries are isolated", async () => {
      const storage = createMemoryStorage();
      await storage.audio.saveAudio(Buffer.from("audio-a"), "audio/wav", undefined, "user-a");
      await storage.audio.saveAudio(Buffer.from("audio-b"), "audio/wav", undefined, "user-b");

      const listA = await storage.audio.listAudio("user-a");
      expect(listA).toHaveLength(1);
    });

    test("listAudio without scopeId returns all", async () => {
      const storage = createMemoryStorage();
      await storage.audio.saveAudio(Buffer.from("audio-a"), "audio/wav", undefined, "user-a");
      await storage.audio.saveAudio(Buffer.from("audio-b"), "audio/wav", undefined, "user-b");

      const all = await storage.audio.listAudio();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    test("getAudio with scopeId retrieves scoped entry", async () => {
      const storage = createMemoryStorage();
      const entry = await storage.audio.saveAudio(Buffer.from("audio-a"), "audio/wav", undefined, "user-a");

      const result = await storage.audio.getAudio(entry.id, "user-a");
      expect(result).not.toBeNull();
    });

    test("deleteAudio with scopeId deletes only scoped entry", async () => {
      const storage = createMemoryStorage();
      const entryA = await storage.audio.saveAudio(Buffer.from("audio-a"), "audio/wav", undefined, "user-a");
      await storage.audio.saveAudio(Buffer.from("audio-b"), "audio/wav", undefined, "user-b");

      await storage.audio.deleteAudio(entryA.id, "user-a");

      const listA = await storage.audio.listAudio("user-a");
      const listB = await storage.audio.listAudio("user-b");
      expect(listA).toHaveLength(0);
      expect(listB).toHaveLength(1);
    });

    test("cleanupOlderThan with scopeId cleans only scoped entries", async () => {
      const storage = createMemoryStorage();
      await storage.audio.saveAudio(Buffer.from("audio-a"), "audio/wav", undefined, "user-a");
      await storage.audio.saveAudio(Buffer.from("audio-b"), "audio/wav", undefined, "user-b");

      // Use -1 so cutoff = Date.now() + 1, guaranteeing all entries are "older"
      const deleted = await storage.audio.cleanupOlderThan(-1, "user-a");
      expect(deleted).toBe(1);

      const listB = await storage.audio.listAudio("user-b");
      expect(listB).toHaveLength(1);
    });
  });
});
