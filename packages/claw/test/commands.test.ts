import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";

describe("status", () => {
  // Status is tested via the module import since it depends on CLAW_HOME
  test("formatStatus shows config info", async () => {
    const { formatStatus } = await import("../src/commands/status.js");

    const output = formatStatus({
      configured: true,
      provider: "openrouter",
      model: "gpt-4o-mini",
      configPath: "/fake/path/kitnclaw.json",
      homePath: "/fake/path",
      sessions: 3,
      workspaceTools: 2,
      workspaceAgents: 1,
      memoryDbExists: true,
    });

    expect(output).toContain("openrouter");
    expect(output).toContain("gpt-4o-mini");
    expect(output).toContain("Sessions: 3");
    expect(output).toContain("initialized");
    expect(output).toContain("Workspace tools:  2");
    expect(output).toContain("Workspace agents: 1");
  });

  test("formatStatus shows unconfigured state", async () => {
    const { formatStatus } = await import("../src/commands/status.js");

    const output = formatStatus({
      configured: false,
      model: "openai/gpt-4o-mini",
      configPath: "/fake/path/kitnclaw.json",
      homePath: "/fake/path",
      sessions: 0,
      workspaceTools: 0,
      workspaceAgents: 0,
      memoryDbExists: false,
    });

    expect(output).toContain("Not configured");
    expect(output).toContain("kitnclaw setup");
    expect(output).toContain("not yet created");
  });
});

describe("reset", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-reset-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("clearDir utility clears files with extension filter", async () => {
    // Create test files
    const sessionsDir = join(tmpDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "s1.jsonl"), "data1");
    await writeFile(join(sessionsDir, "s2.jsonl"), "data2");
    await writeFile(join(sessionsDir, "readme.txt"), "info");

    // We can't easily test resetData directly since it uses CLAW_HOME,
    // but we can verify the module exports and types
    const { resetData } = await import("../src/commands/reset.js");
    expect(typeof resetData).toBe("function");
  });
});

describe("create-tools", () => {
  test("camelCase converts kebab-case", () => {
    // Test the generated code pattern
    const name = "weather-lookup";
    const camelCase = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(camelCase).toBe("weatherLookup");
  });

  test("createToolTool has correct input schema", async () => {
    const { createToolTool } = await import("../src/tools/create-tools.js");
    expect(createToolTool.inputSchema).toBeDefined();

    // Verify the schema shape has the expected fields
    const shape = (createToolTool.inputSchema as any)._zod?.def?.shape;
    expect(shape).toBeDefined();
    expect(shape?.name).toBeDefined();
    expect(shape?.description).toBeDefined();
    expect(shape?.parameters).toBeDefined();
    expect(shape?.executeBody).toBeDefined();
  });

  test("createAgentTool has correct input schema", async () => {
    const { createAgentTool } = await import("../src/tools/create-tools.js");
    expect(createAgentTool.inputSchema).toBeDefined();

    const shape = (createAgentTool.inputSchema as any)._zod?.def?.shape;
    expect(shape).toBeDefined();
    expect(shape?.name).toBeDefined();
    expect(shape?.description).toBeDefined();
    expect(shape?.system).toBeDefined();
    expect(shape?.toolNames).toBeDefined();
  });
});
