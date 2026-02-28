import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveToolByName,
  resolveAgentByName,
  listTools,
  listAgents,
} from "../src/utils/component-resolver.js";
import type { KitnConfig } from "../src/utils/config.js";

const baseConfig: KitnConfig = {
  runtime: "bun",
  aliases: {
    agents: "src/ai/agents",
    tools: "src/ai/tools",
    skills: "src/ai/skills",
    storage: "src/ai/storage",
  },
  registries: {},
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kitn-resolver-"));
  await mkdir(join(tmpDir, "src/ai/tools"), { recursive: true });
  await mkdir(join(tmpDir, "src/ai/agents"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("resolveToolByName", () => {
  test("resolves a tool by name from filesystem", async () => {
    await writeFile(
      join(tmpDir, "src/ai/tools/weather.ts"),
      `import { tool } from "ai";\nexport const weatherTool = tool({ description: "Get weather" });\n`,
    );

    const result = await resolveToolByName("weather", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/tools/weather.ts"));
    expect(result!.exportName).toBe("weatherTool");
    expect(result!.importPath).toBe("../tools/weather.js");
  });

  test("resolves a tool by name from lock file", async () => {
    await writeFile(
      join(tmpDir, "src/ai/tools/weather.ts"),
      `import { tool } from "ai";\nexport const weatherTool = tool({ description: "Get weather" });\n`,
    );
    await writeFile(
      join(tmpDir, "kitn.lock"),
      JSON.stringify({
        "weather-tool": {
          version: "1.0.0",
          installedAt: "2026-01-01T00:00:00Z",
          files: ["src/ai/tools/weather.ts"],
          hash: "abc123",
          type: "kitn:tool",
        },
      }),
    );

    const result = await resolveToolByName("weather-tool", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/tools/weather.ts"));
    expect(result!.exportName).toBe("weatherTool");
    expect(result!.importPath).toBe("../tools/weather.js");
  });

  test("resolves a tool when name has '-tool' suffix but file doesn't", async () => {
    await writeFile(
      join(tmpDir, "src/ai/tools/calculator.ts"),
      `import { tool } from "ai";\nexport const calculatorTool = tool({ description: "Calculate" });\n`,
    );

    const result = await resolveToolByName("calculator-tool", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/tools/calculator.ts"));
    expect(result!.exportName).toBe("calculatorTool");
    expect(result!.importPath).toBe("../tools/calculator.js");
  });

  test("returns null when tool not found", async () => {
    const result = await resolveToolByName("nonexistent", baseConfig, tmpDir);
    expect(result).toBeNull();
  });

  test("prefers exact name match over stripped suffix", async () => {
    await writeFile(
      join(tmpDir, "src/ai/tools/echo-tool.ts"),
      `export const echoToolHelper = tool({ description: "Echo tool" });\n`,
    );
    await writeFile(
      join(tmpDir, "src/ai/tools/echo.ts"),
      `export const echoTool = tool({ description: "Echo" });\n`,
    );

    const result = await resolveToolByName("echo-tool", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    // Should find echo-tool.ts first (exact match)
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/tools/echo-tool.ts"));
    expect(result!.exportName).toBe("echoToolHelper");
  });
});

describe("resolveAgentByName", () => {
  test("resolves agent by name", async () => {
    await writeFile(
      join(tmpDir, "src/ai/agents/weather-agent.ts"),
      `import { registerAgent } from "@kitn/core";\nregisterAgent({ name: "weather-agent", description: "Weather", system: "You are a weather bot", tools: {} });\n`,
    );

    const result = await resolveAgentByName("weather-agent", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/agents/weather-agent.ts"));
    expect(result!.name).toBe("weather-agent");
  });

  test("resolves agent when name has '-agent' suffix but file doesn't", async () => {
    await writeFile(
      join(tmpDir, "src/ai/agents/general.ts"),
      `import { registerAgent } from "@kitn/core";\nregisterAgent({ name: "general", description: "General", system: "You help", tools: {} });\n`,
    );

    const result = await resolveAgentByName("general-agent", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/agents/general.ts"));
    expect(result!.name).toBe("general");
  });

  test("falls back to filename when registerAgent name not found", async () => {
    await writeFile(
      join(tmpDir, "src/ai/agents/custom.ts"),
      `// No registerAgent call, just some agent setup code\nexport const config = { system: "hello" };\n`,
    );

    const result = await resolveAgentByName("custom", baseConfig, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(join(tmpDir, "src/ai/agents/custom.ts"));
    expect(result!.name).toBe("custom");
  });

  test("returns null when agent not found", async () => {
    const result = await resolveAgentByName("nonexistent", baseConfig, tmpDir);
    expect(result).toBeNull();
  });
});

describe("listTools", () => {
  test("lists tools from directory", async () => {
    await writeFile(join(tmpDir, "src/ai/tools/weather.ts"), `export const weatherTool = tool({});\n`);
    await writeFile(join(tmpDir, "src/ai/tools/calculator.ts"), `export const calculatorTool = tool({});\n`);

    const result = await listTools(baseConfig, tmpDir);
    expect(result).toHaveLength(2);
    // Sorted alphabetically
    expect(result[0].name).toBe("calculator");
    expect(result[0].filePath).toBe(join(tmpDir, "src/ai/tools/calculator.ts"));
    expect(result[1].name).toBe("weather");
    expect(result[1].filePath).toBe(join(tmpDir, "src/ai/tools/weather.ts"));
  });

  test("returns empty array if directory doesn't exist", async () => {
    const config: KitnConfig = {
      ...baseConfig,
      aliases: { ...baseConfig.aliases, tools: "src/ai/nonexistent" },
    };
    const result = await listTools(config, tmpDir);
    expect(result).toEqual([]);
  });

  test("excludes .test.ts and .d.ts files", async () => {
    await writeFile(join(tmpDir, "src/ai/tools/weather.ts"), `export const weatherTool = tool({});\n`);
    await writeFile(join(tmpDir, "src/ai/tools/weather.test.ts"), `test("weather", () => {});\n`);
    await writeFile(join(tmpDir, "src/ai/tools/types.d.ts"), `declare module "weather" {};\n`);

    const result = await listTools(baseConfig, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("weather");
  });
});

describe("listAgents", () => {
  test("lists agents from directory", async () => {
    await writeFile(join(tmpDir, "src/ai/agents/general.ts"), `registerAgent({ name: "general" });\n`);
    await writeFile(join(tmpDir, "src/ai/agents/weather-agent.ts"), `registerAgent({ name: "weather-agent" });\n`);

    const result = await listAgents(baseConfig, tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("general");
    expect(result[0].filePath).toBe(join(tmpDir, "src/ai/agents/general.ts"));
    expect(result[1].name).toBe("weather-agent");
    expect(result[1].filePath).toBe(join(tmpDir, "src/ai/agents/weather-agent.ts"));
  });

  test("returns empty array if directory doesn't exist", async () => {
    const config: KitnConfig = {
      ...baseConfig,
      aliases: { ...baseConfig.aliases, agents: "src/ai/nonexistent" },
    };
    const result = await listAgents(config, tmpDir);
    expect(result).toEqual([]);
  });
});
