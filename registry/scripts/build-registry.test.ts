import { describe, it, expect } from "bun:test";
import { buildRegistryItem, buildRegistryIndex } from "./build-registry.js";
import type { RegistryItem } from "../src/schema.js";

describe("buildRegistryItem", () => {
  it("creates a registry item from a manifest and source files", () => {
    const manifest = {
      name: "test-agent",
      type: "kitn:agent" as const,
      description: "A test agent",
      registryDependencies: ["test-tool"],
      files: ["test-agent.ts"],
    };
    const fileContents = {
      "test-agent.ts": 'export const testAgent = "hello";',
    };

    const result = buildRegistryItem(manifest, fileContents);

    expect(result.name).toBe("test-agent");
    expect(result.type).toBe("kitn:agent");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBe('export const testAgent = "hello";');
    expect(result.files[0].path).toBe("agents/test-agent.ts");
    expect(result.registryDependencies).toEqual(["test-tool"]);
  });
});

describe("buildRegistryIndex", () => {
  it("creates an index from a list of registry items", () => {
    const items: RegistryItem[] = [
      {
        name: "weather-agent",
        type: "kitn:agent",
        description: "Weather agent",
        registryDependencies: ["weather-tool"],
        files: [{ path: "agents/weather-agent.ts", content: "...", type: "kitn:agent" }],
        categories: ["weather"],
        version: "1.0.0",
      },
    ];

    const index = buildRegistryIndex(items);

    expect(index.version).toBe("1.0.0");
    expect(index.items).toHaveLength(1);
    expect(index.items[0].name).toBe("weather-agent");
    expect(index.items[0]).not.toHaveProperty("files");
  });
});
