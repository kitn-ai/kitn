import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LibsqlMemoryStore } from "../src/memory/store.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("LibsqlMemoryStore", () => {
  let tmpDir: string;
  let store: LibsqlMemoryStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-memory-"));
    store = new LibsqlMemoryStore(join(tmpDir, "memory.db"));
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true });
  });

  test("saves and retrieves an entry", async () => {
    await store.saveEntry("ns1", "key1", "hello world", "test context");
    const entry = await store.getEntry("ns1", "key1");
    expect(entry).not.toBeNull();
    expect(entry!.key).toBe("key1");
    expect(entry!.value).toBe("hello world");
    expect(entry!.context).toBe("test context");
  });

  test("returns null for non-existent entry", async () => {
    const entry = await store.getEntry("ns1", "nope");
    expect(entry).toBeNull();
  });

  test("upserts on duplicate key", async () => {
    await store.saveEntry("ns1", "key1", "first");
    await store.saveEntry("ns1", "key1", "second");
    const entry = await store.getEntry("ns1", "key1");
    expect(entry!.value).toBe("second");
  });

  test("lists entries in a namespace", async () => {
    await store.saveEntry("ns1", "a", "val-a");
    await store.saveEntry("ns1", "b", "val-b");
    await store.saveEntry("ns2", "c", "val-c");

    const entries = await store.listEntries("ns1");
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.key).sort()).toEqual(["a", "b"]);
  });

  test("lists namespaces", async () => {
    await store.saveEntry("alpha", "k", "v");
    await store.saveEntry("beta", "k", "v");
    const ns = await store.listNamespaces();
    expect(ns.sort()).toEqual(["alpha", "beta"]);
  });

  test("deletes an entry", async () => {
    await store.saveEntry("ns1", "to-delete", "val");
    const deleted = await store.deleteEntry("ns1", "to-delete");
    expect(deleted).toBe(true);
    const entry = await store.getEntry("ns1", "to-delete");
    expect(entry).toBeNull();
  });

  test("clears a namespace", async () => {
    await store.saveEntry("ns1", "a", "1");
    await store.saveEntry("ns1", "b", "2");
    await store.clearNamespace("ns1");
    const entries = await store.listEntries("ns1");
    expect(entries.length).toBe(0);
  });

  test("loads memories for multiple namespace IDs", async () => {
    await store.saveEntry("ns1", "a", "val-a");
    await store.saveEntry("ns2", "b", "val-b");
    await store.saveEntry("ns3", "c", "val-c");

    const memories = await store.loadMemoriesForIds(["ns1", "ns2"]);
    expect(memories.length).toBe(2);
    expect(memories.map((m) => m.namespace).sort()).toEqual(["ns1", "ns2"]);
  });

  test("full-text search returns matching entries", async () => {
    await store.saveEntry("search-ns", "weather", "Tokyo weather is sunny today");
    await store.saveEntry("search-ns", "news", "Latest breaking news about technology");
    await store.saveEntry("search-ns", "recipe", "Chocolate cake recipe instructions");

    const results = await store.search("search-ns", "weather sunny");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toBe("weather");
  });
});
