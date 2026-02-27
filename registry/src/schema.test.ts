import { describe, it, expect } from "bun:test";
import {
  registryItemSchema,
  registryIndexSchema,
  configSchema,
  type RegistryItem,
  type RegistryIndex,
  type KitnConfig,
} from "./schema.js";

describe("registryItemSchema", () => {
  it("validates a minimal agent item", () => {
    const item = {
      name: "weather-agent",
      type: "kitn:agent" as const,
      description: "Weather lookup agent",
      files: [
        {
          path: "agents/weather-agent.ts",
          content: 'console.log("hello")',
          type: "kitn:agent" as const,
        },
      ],
    };
    const parsed = registryItemSchema.parse(item);
    // version has a default of "1.0.0", so parsed result includes it
    expect(parsed).toEqual({ ...item, version: "1.0.0" });
  });

  it("validates a tool with dependencies and envVars", () => {
    const item: RegistryItem = {
      name: "web-search-tool",
      type: "kitn:tool",
      description: "Search the web using Brave",
      dependencies: ["zod"],
      registryDependencies: [],
      envVars: { BRAVE_SEARCH_API_KEY: "Get from https://brave.com" },
      files: [
        {
          path: "tools/web-search.ts",
          content: "export const searchTool = tool({})",
          type: "kitn:tool",
        },
      ],
      docs: "Requires BRAVE_SEARCH_API_KEY env var",
    };
    expect(registryItemSchema.parse(item)).toBeDefined();
  });

  it("rejects invalid type", () => {
    expect(() =>
      registryItemSchema.parse({
        name: "test",
        type: "invalid:type",
        description: "test",
        files: [],
      })
    ).toThrow();
  });
});

describe("registryIndexSchema", () => {
  it("validates a registry index", () => {
    const index: RegistryIndex = {
      version: "1.0.0",
      items: [
        {
          name: "weather-agent",
          type: "kitn:agent",
          description: "Weather agent",
          registryDependencies: ["weather-tool"],
          categories: ["weather"],
        },
      ],
    };
    expect(registryIndexSchema.parse(index)).toBeDefined();
  });
});

describe("configSchema", () => {
  it("validates a kitn.json config", () => {
    const config: KitnConfig = {
      runtime: "bun",
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: {
        "@kitn": "https://kitn.dev/r/{name}.json",
      },
    };
    expect(configSchema.parse(config)).toBeDefined();
  });

  it("validates config with installed section", () => {
    const config: KitnConfig = {
      runtime: "node",
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: {},
      installed: {
        "weather-agent": {
          version: "1.0.0",
          installedAt: "2026-02-24T10:30:00Z",
          files: ["src/agents/weather-agent.ts"],
          hash: "a1b2c3d4",
        },
      },
    };
    expect(configSchema.parse(config)).toBeDefined();
  });
});
