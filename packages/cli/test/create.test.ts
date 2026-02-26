import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createComponent } from "../src/commands/create.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kitn-create-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("createComponent", () => {
  test("creates an agent component", async () => {
    await createComponent("agent", "weather-agent", { cwd: testDir });

    const dir = join(testDir, "weather-agent");
    const registry = JSON.parse(
      await readFile(join(dir, "registry.json"), "utf-8")
    );

    expect(registry.name).toBe("weather-agent");
    expect(registry.type).toBe("kitn:agent");
    expect(registry.version).toBe("0.1.0");
    expect(registry.files).toEqual(["weather-agent.ts"]);

    const source = await readFile(join(dir, "weather-agent.ts"), "utf-8");
    expect(source).toContain("AgentConfig");
    expect(source).toContain('name: "weather-agent"');
    expect(source).toContain("weatherAgentConfig");
  });

  test("creates a tool component", async () => {
    await createComponent("tool", "fetch-url", { cwd: testDir });

    const dir = join(testDir, "fetch-url");
    const registry = JSON.parse(
      await readFile(join(dir, "registry.json"), "utf-8")
    );

    expect(registry.dependencies).toContain("ai");
    expect(registry.dependencies).toContain("zod");
    expect(registry.files).toEqual(["fetch-url.ts"]);

    const source = await readFile(join(dir, "fetch-url.ts"), "utf-8");
    expect(source).toContain("tool(");
    expect(source).toContain("fetchUrl");
  });

  test("creates a skill component", async () => {
    await createComponent("skill", "my-skill", { cwd: testDir });

    const dir = join(testDir, "my-skill");
    const registry = JSON.parse(
      await readFile(join(dir, "registry.json"), "utf-8")
    );

    expect(registry.files).toEqual(["README.md"]);

    const readme = await readFile(join(dir, "README.md"), "utf-8");
    expect(readme).toContain("my-skill");
    expect(readme).toContain("# My Skill");
  });

  test("creates a storage component", async () => {
    await createComponent("storage", "redis-store", { cwd: testDir });

    const dir = join(testDir, "redis-store");
    const source = await readFile(join(dir, "redis-store.ts"), "utf-8");
    expect(source).toContain("StorageProvider");
    expect(source).toContain("createRedisStore");
  });

  test("throws if directory already exists", async () => {
    const { mkdir } = await import("fs/promises");
    await mkdir(join(testDir, "existing"));

    expect(
      createComponent("agent", "existing", { cwd: testDir })
    ).rejects.toThrow("already exists");
  });

  test("rejects invalid type", async () => {
    expect(
      createComponent("widget", "my-widget", { cwd: testDir })
    ).rejects.toThrow("Invalid component type");
  });
});
