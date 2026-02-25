/**
 * In-memory MemoryStore tests.
 * Run with: bun test packages/core/test/memory-store.test.ts
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { createInMemoryMemoryStore } from "../src/storage/in-memory/memory-store.js";

describe("createInMemoryMemoryStore", () => {
  let store: ReturnType<typeof createInMemoryMemoryStore>;

  beforeEach(() => {
    store = createInMemoryMemoryStore();
  });

  test("saveEntry stores and returns an entry", async () => {
    const entry = await store.saveEntry("test-ns", "color", "blue", "user preference");
    expect(entry.key).toBe("color");
    expect(entry.value).toBe("blue");
    expect(entry.context).toBe("user preference");
  });

  test("getEntry retrieves a stored entry", async () => {
    await store.saveEntry("test-ns", "color", "blue", "user preference");
    const retrieved = await store.getEntry("test-ns", "color");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toBe("blue");
  });

  test("getEntry returns null for missing key", async () => {
    expect(await store.getEntry("test-ns", "nonexistent")).toBeNull();
  });

  test("listEntries returns all entries in a namespace", async () => {
    await store.saveEntry("test-ns", "color", "blue");
    await store.saveEntry("test-ns", "name", "Alice");

    const entries = await store.listEntries("test-ns");
    expect(entries).toHaveLength(2);
  });

  test("listNamespaces returns populated namespaces", async () => {
    await store.saveEntry("ns-a", "key", "val");
    await store.saveEntry("ns-b", "key", "val");

    const namespaces = await store.listNamespaces();
    expect(namespaces).toContain("ns-a");
    expect(namespaces).toContain("ns-b");
  });

  test("loadMemoriesForIds returns entries with namespace attached", async () => {
    await store.saveEntry("test-ns", "color", "blue");
    await store.saveEntry("test-ns", "name", "Alice");

    const loaded = await store.loadMemoriesForIds(["test-ns"]);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].namespace).toBe("test-ns");
  });

  test("deleteEntry removes a specific entry", async () => {
    await store.saveEntry("test-ns", "color", "blue");

    const deleted = await store.deleteEntry("test-ns", "color");
    expect(deleted).toBe(true);
    expect(await store.getEntry("test-ns", "color")).toBeNull();
  });

  test("deleteEntry returns false for missing key", async () => {
    expect(await store.deleteEntry("test-ns", "nonexistent")).toBe(false);
  });

  test("clearNamespace removes all entries", async () => {
    await store.saveEntry("test-ns", "a", "1");
    await store.saveEntry("test-ns", "b", "2");

    await store.clearNamespace("test-ns");
    expect(await store.listEntries("test-ns")).toHaveLength(0);
  });
});
