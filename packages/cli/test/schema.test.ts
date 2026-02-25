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

  test("accepts config without framework (backwards compat)", () => {
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
