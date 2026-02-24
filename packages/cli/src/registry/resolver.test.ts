import { describe, it, expect } from "bun:test";
import { resolveDependencies } from "./resolver.js";
import type { RegistryItem } from "./schema.js";

const mockItems: Record<string, RegistryItem> = {
  "weather-tool": {
    name: "weather-tool",
    type: "kitn:tool",
    description: "Weather tool",
    files: [{ path: "tools/weather.ts", content: "...", type: "kitn:tool" }],
  },
  "weather-agent": {
    name: "weather-agent",
    type: "kitn:agent",
    description: "Weather agent",
    registryDependencies: ["weather-tool"],
    files: [{ path: "agents/weather-agent.ts", content: "...", type: "kitn:agent" }],
  },
  "hackernews-tool": {
    name: "hackernews-tool",
    type: "kitn:tool",
    description: "HN tool",
    files: [{ path: "tools/hackernews.ts", content: "...", type: "kitn:tool" }],
  },
  "supervisor-agent": {
    name: "supervisor-agent",
    type: "kitn:agent",
    description: "Supervisor",
    registryDependencies: ["weather-agent", "hackernews-tool"],
    files: [{ path: "agents/supervisor-agent.ts", content: "...", type: "kitn:agent" }],
  },
};

const mockFetch = async (name: string): Promise<RegistryItem> => {
  const item = mockItems[name];
  if (!item) throw new Error(`Unknown component: ${name}`);
  return item;
};

describe("resolveDependencies", () => {
  it("returns a single item with no deps", async () => {
    const result = await resolveDependencies(["weather-tool"], mockFetch);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("weather-tool");
  });

  it("resolves direct dependencies", async () => {
    const result = await resolveDependencies(["weather-agent"], mockFetch);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("weather-tool");
    expect(result[1].name).toBe("weather-agent");
  });

  it("resolves transitive dependencies", async () => {
    const result = await resolveDependencies(["supervisor-agent"], mockFetch);
    expect(result).toHaveLength(4);
    const names = result.map((r) => r.name);
    expect(names.indexOf("weather-tool")).toBeLessThan(names.indexOf("weather-agent"));
    expect(names.indexOf("supervisor-agent")).toBe(names.length - 1);
  });

  it("deduplicates shared dependencies", async () => {
    const result = await resolveDependencies(["weather-agent", "weather-tool"], mockFetch);
    expect(result).toHaveLength(2);
  });

  it("handles empty input", async () => {
    const result = await resolveDependencies([], mockFetch);
    expect(result).toHaveLength(0);
  });
});
