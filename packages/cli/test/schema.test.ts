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

describe("config schema rejects installed field", () => {
  test("config without installed is valid", () => {
    const { configSchema } = require("../src/utils/config.js");
    const config = {
      runtime: "bun",
      framework: "hono",
      aliases: { base: "src/ai", agents: "src/ai/agents", tools: "src/ai/tools", skills: "src/ai/skills", storage: "src/ai/storage" },
      registries: { "@kitn": "https://example.com/r/{type}/{name}.json" },
    };
    expect(() => configSchema.parse(config)).not.toThrow();
  });
});

describe("lock schema", () => {
  test("lock entry with all required fields", () => {
    const { lockSchema } = require("../src/utils/config.js");
    const lock = {
      lockfileVersion: 1,
      components: {
        "weather-agent": {
          registry: "@kitn",
          type: "kitn:agent",
          version: "1.0.0",
          installedAt: "2026-02-25T00:00:00Z",
          files: ["src/ai/agents/weather-agent.ts"],
          integrity: "sha256:abc123",
          resolved: "https://kitn-ai.github.io/kitn/r/agents/weather-agent.json",
        },
      },
    };
    expect(() => lockSchema.parse(lock)).not.toThrow();
  });

  test("rejects lock entry without required registry", () => {
    const { lockSchema } = require("../src/utils/config.js");
    const lock = {
      lockfileVersion: 1,
      components: {
        "weather-agent": {
          type: "kitn:agent",
          version: "1.0.0",
          installedAt: "2026-02-25T00:00:00Z",
          files: ["src/agents/weather-agent.ts"],
          integrity: "sha256:abc123",
          resolved: "https://example.com",
        },
      },
    };
    expect(() => lockSchema.parse(lock)).toThrow();
  });

  test("empty lock is valid", () => {
    const { lockSchema } = require("../src/utils/config.js");
    expect(() => lockSchema.parse({ lockfileVersion: 1, components: {} })).not.toThrow();
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
