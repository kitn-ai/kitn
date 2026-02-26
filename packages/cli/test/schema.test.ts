import { describe, test, expect } from "bun:test";

describe("registry schema", () => {
  test("accepts kitn:package type", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "core",
      type: "kitn:package",
      description: "Framework-agnostic engine",
      files: [{ path: "core/index.ts", content: "export {}", type: "kitn:package" }],
      installDir: "core",
      tsconfig: { "@kitnai/core": ["./index.ts"] },
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("package installDir and tsconfig are optional", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "core",
      type: "kitn:package",
      description: "test",
      files: [{ path: "core/index.ts", content: "", type: "kitn:package" }],
    };
    const parsed = registryItemSchema.parse(item);
    expect(parsed.installDir).toBeUndefined();
    expect(parsed.tsconfig).toBeUndefined();
  });
});

describe("config schema", () => {
  test("accepts framework field", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "bun",
      framework: "hono",
      aliases: {
        base: "src/ai",
        agents: "src/ai/agents",
        tools: "src/ai/tools",
        skills: "src/ai/skills",
        storage: "src/ai/storage",
      },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });

  test("accepts config without framework", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "bun",
      aliases: {
        agents: "src/agents",
        tools: "src/tools",
        skills: "src/skills",
        storage: "src/storage",
      },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });

  test("accepts config with base alias", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "node",
      aliases: {
        base: "src/ai",
        agents: "src/ai/agents",
        tools: "src/ai/tools",
        skills: "src/ai/skills",
        storage: "src/ai/storage",
      },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    const parsed = configSchema.parse(config);
    expect(parsed.aliases.base).toBe("src/ai");
  });
});

describe("installed tracking", () => {
  test("installed entry accepts registry field", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "bun",
      framework: "hono",
      aliases: { base: "src/ai", agents: "src/ai/agents", tools: "src/ai/tools", skills: "src/ai/skills", storage: "src/ai/storage" },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
      installed: {
        "weather-agent": {
          registry: "@kitn",
          version: "1.0.0",
          installedAt: "2026-02-25T00:00:00Z",
          files: ["src/ai/agents/weather-agent.ts"],
          hash: "abc12345",
        },
      },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });

  test("registry field is optional", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "bun",
      aliases: { agents: "src/agents", tools: "src/tools", skills: "src/skills", storage: "src/storage" },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
      installed: {
        "weather-agent": {
          version: "1.0.0",
          installedAt: "2026-02-25T00:00:00Z",
          files: ["src/agents/weather-agent.ts"],
          hash: "abc12345",
        },
      },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });
});

describe("changelog schema", () => {
  test("accepts changelog on registry item", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      files: [{ path: "agents/test.ts", content: "", type: "kitn:agent" }],
      version: "1.1.0",
      updatedAt: "2026-02-25T16:30:00Z",
      changelog: [
        { version: "1.1.0", date: "2026-02-25", type: "feature", note: "Added streaming" },
        { version: "1.0.0", date: "2026-02-15", type: "initial", note: "Initial release" },
      ],
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("changelog is optional", () => {
    const { registryItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      files: [{ path: "agents/test.ts", content: "", type: "kitn:agent" }],
    };
    expect(() => registryItemSchema.parse(item)).not.toThrow();
  });

  test("registry index includes versions array and updatedAt", () => {
    const { registryIndexItemSchema } = require("../src/registry/schema.js");
    const item = {
      name: "test",
      type: "kitn:agent",
      description: "test",
      version: "1.1.0",
      versions: ["1.1.0", "1.0.0"],
      updatedAt: "2026-02-25T16:30:00Z",
    };
    expect(() => registryIndexItemSchema.parse(item)).not.toThrow();
  });
});
