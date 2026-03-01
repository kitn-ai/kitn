import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import { createComponentInProject } from "../src/commands/create.js";

let testDir: string;

const KITN_CONFIG = {
  runtime: "bun",
  aliases: {
    base: "src/ai",
    agents: "src/ai/agents",
    tools: "src/ai/tools",
    skills: "src/ai/skills",
    storage: "src/ai/storage",
  },
  registries: { "@kitn": "https://kitn.dev/r" },
};

async function setupProject(dir: string) {
  await writeFile(join(dir, "kitn.json"), JSON.stringify(KITN_CONFIG, null, 2));
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kitn-create-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("createComponentInProject", () => {
  test("creates an agent at the correct path", async () => {
    await setupProject(testDir);
    const { filePath } = await createComponentInProject("agent", "weather-agent", { cwd: testDir });

    expect(filePath).toBe(join(testDir, "src/ai/agents/weather-agent.ts"));
    const source = await readFile(filePath, "utf-8");
    expect(source).toContain("registerAgent");
    expect(source).toContain('name: "weather-agent"');
    expect(source).toContain("@kitn/core");
  });

  test("creates a tool at the correct path", async () => {
    await setupProject(testDir);
    const { filePath } = await createComponentInProject("tool", "fetch-url", { cwd: testDir });

    expect(filePath).toBe(join(testDir, "src/ai/tools/fetch-url.ts"));
    const source = await readFile(filePath, "utf-8");
    expect(source).toContain("tool(");
    expect(source).toContain("registerTool");
    expect(source).toContain("fetchUrl");
  });

  test("creates a skill as a markdown file", async () => {
    await setupProject(testDir);
    const { filePath } = await createComponentInProject("skill", "my-skill", { cwd: testDir });

    expect(filePath).toBe(join(testDir, "src/ai/skills/my-skill.md"));
    const source = await readFile(filePath, "utf-8");
    expect(source).toContain("my-skill");
    expect(source).toContain("# My Skill");
    expect(source).toContain("---");
  });

  test("creates a storage component at the correct path", async () => {
    await setupProject(testDir);
    const { filePath } = await createComponentInProject("storage", "redis-store", { cwd: testDir });

    expect(filePath).toBe(join(testDir, "src/ai/storage/redis-store.ts"));
    const source = await readFile(filePath, "utf-8");
    expect(source).toContain("StorageProvider");
    expect(source).toContain("createRedisStore");
  });

  test("updates barrel file for agents", async () => {
    await setupProject(testDir);
    const { barrelUpdated } = await createComponentInProject("agent", "weather-agent", { cwd: testDir });

    expect(barrelUpdated).toBe(true);
    const barrel = await readFile(join(testDir, "src/ai/index.ts"), "utf-8");
    expect(barrel).toContain('./agents/weather-agent.js');
  });

  test("updates barrel file for tools", async () => {
    await setupProject(testDir);
    const { barrelUpdated } = await createComponentInProject("tool", "fetch-url", { cwd: testDir });

    expect(barrelUpdated).toBe(true);
    const barrel = await readFile(join(testDir, "src/ai/index.ts"), "utf-8");
    expect(barrel).toContain('./tools/fetch-url.js');
  });

  test("updates barrel file for skills", async () => {
    await setupProject(testDir);
    const { barrelUpdated } = await createComponentInProject("skill", "my-skill", { cwd: testDir });

    expect(barrelUpdated).toBe(true);
    const barrel = await readFile(join(testDir, "src/ai/index.ts"), "utf-8");
    expect(barrel).toContain('./skills/my-skill.md');
  });

  test("does NOT update barrel file for storage", async () => {
    await setupProject(testDir);
    const { barrelUpdated } = await createComponentInProject("storage", "redis-store", { cwd: testDir });

    expect(barrelUpdated).toBe(false);
    expect(existsSync(join(testDir, "src/ai/index.ts"))).toBe(false);
  });

  test("overwrites existing file when overwrite option is set", async () => {
    await setupProject(testDir);
    await mkdir(join(testDir, "src/ai/agents"), { recursive: true });
    await writeFile(join(testDir, "src/ai/agents/weather-agent.ts"), "existing");

    const { filePath } = await createComponentInProject("agent", "weather-agent", {
      cwd: testDir,
      overwrite: true,
    });

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("registerAgent");
    expect(content).not.toBe("existing");
  });

  test("throws if no kitn.json", async () => {
    expect(
      createComponentInProject("agent", "my-agent", { cwd: testDir })
    ).rejects.toThrow("No kitn.json");
  });

  test("rejects invalid type", async () => {
    await setupProject(testDir);
    expect(
      createComponentInProject("widget", "my-widget", { cwd: testDir })
    ).rejects.toThrow("Invalid component type");
  });

  test("does not create registry.json", async () => {
    await setupProject(testDir);
    await createComponentInProject("agent", "weather-agent", { cwd: testDir });

    expect(existsSync(join(testDir, "registry.json"))).toBe(false);
    expect(existsSync(join(testDir, "weather-agent/registry.json"))).toBe(false);
  });
});
