import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CredentialStore } from "../src/config/credentials.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-creds-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("CredentialStore", () => {
  test("stores and retrieves credentials", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("openai-key", "sk-test-123");
    expect(await store.get("openai-key")).toBe("sk-test-123");
  });

  test("deletes credentials", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("key1", "val1");
    await store.delete("key1");
    expect(await store.get("key1")).toBeNull();
  });

  test("returns null for missing keys", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    expect(await store.get("nonexistent")).toBeNull();
  });

  test("lists stored keys", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("key1", "val1");
    await store.set("key2", "val2");
    const keys = await store.list();
    expect(keys.sort()).toEqual(["key1", "key2"]);
  });

  test("overwrites existing credential", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("key1", "old-value");
    await store.set("key1", "new-value");
    expect(await store.get("key1")).toBe("new-value");
  });

  test("delete on missing key does not throw", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    // Should not throw
    await store.delete("nonexistent");
  });

  test("list returns empty array when no credentials", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    expect(await store.list()).toEqual([]);
  });
});
