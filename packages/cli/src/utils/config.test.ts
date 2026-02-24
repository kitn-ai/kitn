import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readConfig, writeConfig, getInstallPath } from "./config.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kitn-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns null when kitn.json does not exist", async () => {
    const config = await readConfig(tempDir);
    expect(config).toBeNull();
  });

  it("reads and parses a valid kitn.json", async () => {
    const configData = {
      runtime: "bun",
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: { "@kitn": "https://kitn.dev/r/{name}.json" },
    };
    await writeFile(join(tempDir, "kitn.json"), JSON.stringify(configData));

    const config = await readConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.runtime).toBe("bun");
    expect(config!.aliases.agents).toBe("src/agents");
  });

  it("writes a config file", async () => {
    const config = {
      runtime: "bun" as const,
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: { "@kitn": "https://kitn.dev/r/{name}.json" },
    };
    await writeConfig(tempDir, config);

    const written = await readConfig(tempDir);
    expect(written).not.toBeNull();
    expect(written!.runtime).toBe("bun");
  });

  it("getInstallPath resolves agent path from config", () => {
    const config = {
      runtime: "bun" as const,
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: {},
    };
    const result = getInstallPath(config, "kitn:agent", "weather-agent.ts");
    expect(result).toBe("src/agents/weather-agent.ts");
  });
});
