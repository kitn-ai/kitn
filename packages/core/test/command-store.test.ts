/**
 * CommandStore tests — covers both in-memory and file-based implementations.
 * Run with: bun test packages/core/test/command-store.test.ts
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";
import { createFileStorage } from "../src/storage/file-storage/index.js";
import type { CommandStore, CommandRegistration } from "../src/storage/interfaces.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const FILE_STORAGE_DIR = join(import.meta.dir, ".tmp-command-store-test");

function makeCommand(overrides: Partial<CommandRegistration> = {}): CommandRegistration {
  return {
    name: "test-cmd",
    description: "A test command",
    system: "You are a test command.",
    tools: ["tool-a"],
    model: "gpt-4",
    format: "json",
    ...overrides,
  };
}

function suiteFor(label: string, getStore: () => CommandStore) {
  describe(label, () => {
    let store: CommandStore;

    beforeEach(() => {
      store = getStore();
    });

    test("save and get a command", async () => {
      const cmd = makeCommand();
      await store.save(cmd);

      const retrieved = await store.get("test-cmd");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("test-cmd");
      expect(retrieved!.description).toBe("A test command");
      expect(retrieved!.system).toBe("You are a test command.");
      expect(retrieved!.tools).toEqual(["tool-a"]);
      expect(retrieved!.model).toBe("gpt-4");
      expect(retrieved!.format).toBe("json");
    });

    test("get returns undefined for missing command", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeUndefined();
    });

    test("list commands", async () => {
      await store.save(makeCommand({ name: "cmd-a", description: "Command A" }));
      await store.save(makeCommand({ name: "cmd-b", description: "Command B" }));

      const commands = await store.list();
      expect(commands).toHaveLength(2);
      const names = commands.map((c) => c.name).sort();
      expect(names).toEqual(["cmd-a", "cmd-b"]);
    });

    test("list returns empty array when no commands", async () => {
      const commands = await store.list();
      expect(commands).toEqual([]);
    });

    test("delete a command", async () => {
      await store.save(makeCommand());
      await store.delete("test-cmd");

      const result = await store.get("test-cmd");
      expect(result).toBeUndefined();
    });

    test("delete a nonexistent command does not throw", async () => {
      // Should not throw
      await store.delete("nonexistent");
    });

    test("save overwrites existing command", async () => {
      await store.save(makeCommand({ description: "Original" }));
      await store.save(makeCommand({ description: "Updated" }));

      const retrieved = await store.get("test-cmd");
      expect(retrieved!.description).toBe("Updated");

      // Should still be only one entry
      const commands = await store.list();
      expect(commands).toHaveLength(1);
    });

    test("list with scopeId filters by scope", async () => {
      await store.save(makeCommand({ name: "global-cmd" }));
      await store.save(makeCommand({ name: "scoped-cmd" }), "tenant-1");
      await store.save(makeCommand({ name: "other-scoped" }), "tenant-2");

      const globalList = await store.list();
      // Unscoped list returns only unscoped commands
      expect(globalList).toHaveLength(1);
      expect(globalList[0].name).toBe("global-cmd");

      const tenant1List = await store.list("tenant-1");
      expect(tenant1List).toHaveLength(1);
      expect(tenant1List[0].name).toBe("scoped-cmd");

      const tenant2List = await store.list("tenant-2");
      expect(tenant2List).toHaveLength(1);
      expect(tenant2List[0].name).toBe("other-scoped");
    });

    test("get with scopeId only returns scoped command", async () => {
      await store.save(makeCommand({ name: "shared" }));
      await store.save(makeCommand({ name: "shared", description: "Scoped version" }), "tenant-1");

      const global = await store.get("shared");
      expect(global).toBeDefined();
      expect(global!.description).toBe("A test command");

      const scoped = await store.get("shared", "tenant-1");
      expect(scoped).toBeDefined();
      expect(scoped!.description).toBe("Scoped version");

      // Different scope returns undefined
      const other = await store.get("shared", "tenant-2");
      expect(other).toBeUndefined();
    });

    test("delete with scopeId only removes scoped command", async () => {
      await store.save(makeCommand({ name: "shared" }));
      await store.save(makeCommand({ name: "shared", description: "Scoped" }), "tenant-1");

      await store.delete("shared", "tenant-1");

      // Scoped version is gone
      const scoped = await store.get("shared", "tenant-1");
      expect(scoped).toBeUndefined();

      // Global version remains
      const global = await store.get("shared");
      expect(global).toBeDefined();
    });

    test("command without optional fields", async () => {
      const minimal: CommandRegistration = {
        name: "minimal",
        description: "Minimal command",
        system: "Minimal system prompt.",
      };
      await store.save(minimal);

      const retrieved = await store.get("minimal");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("minimal");
      expect(retrieved!.tools).toBeUndefined();
      expect(retrieved!.model).toBeUndefined();
      expect(retrieved!.format).toBeUndefined();
    });
  });
}

// ── In-memory suite ──

suiteFor("CommandStore (in-memory)", () => {
  return createMemoryStorage().commands;
});

// ── File-based suite ──

let fileStorageInstance: ReturnType<typeof createFileStorage> | null = null;

suiteFor("CommandStore (file-based)", () => {
  // Each beforeEach creates a fresh file storage pointing to a clean subdir
  const subDir = join(FILE_STORAGE_DIR, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fileStorageInstance = createFileStorage({ dataDir: subDir });
  return fileStorageInstance.commands;
});

afterAll(async () => {
  // Clean up test data directory
  try {
    await rm(FILE_STORAGE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
