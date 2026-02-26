import { describe, test, expect } from "bun:test";
import { componentConfigSchema } from "../src/registry/schema.js";

describe("componentConfigSchema", () => {
  test("validates a standalone component (no package.json)", () => {
    const result = componentConfigSchema.safeParse({
      name: "weather-tool",
      type: "kitn:tool",
      version: "1.0.0",
      description: "Get weather info",
      dependencies: ["ai", "zod"],
      files: ["weather.ts"],
      categories: ["weather"],
    });
    expect(result.success).toBe(true);
  });

  test("validates a package component (has package.json)", () => {
    const result = componentConfigSchema.safeParse({
      type: "kitn:package",
      installDir: "routes",
      registryDependencies: ["core"],
      tsconfig: { "@kitnai/hono": ["./index.ts"] },
      exclude: ["lib/auth.ts"],
      categories: ["http"],
    });
    expect(result.success).toBe(true);
  });

  test("requires type field", () => {
    const result = componentConfigSchema.safeParse({
      name: "test",
      version: "1.0.0",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid type", () => {
    const result = componentConfigSchema.safeParse({
      type: "kitn:invalid",
      name: "test",
    });
    expect(result.success).toBe(false);
  });
});
