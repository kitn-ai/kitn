import { describe, it, expect, beforeEach } from "bun:test";
import { RegistryFetcher } from "./fetcher.js";

describe("RegistryFetcher", () => {
  let fetcher: RegistryFetcher;

  beforeEach(() => {
    fetcher = new RegistryFetcher({
      "@kitn": "https://kitn.dev/r/{type}/{name}.json",
    });
  });

  it("resolves registry URL from component name", () => {
    const url = fetcher.resolveUrl("weather-tool", "tools");
    expect(url).toBe("https://kitn.dev/r/tools/weather-tool.json");
  });

  it("resolves URL for agent type", () => {
    const url = fetcher.resolveUrl("weather-agent", "agents");
    expect(url).toBe("https://kitn.dev/r/agents/weather-agent.json");
  });

  it("uses cache for repeated fetches", async () => {
    let callCount = 0;
    const mockFetcher = new RegistryFetcher(
      { "@kitn": "https://kitn.dev/r/{type}/{name}.json" },
      async (url) => {
        callCount++;
        return {
          name: "test",
          type: "kitn:tool",
          description: "test",
          files: [],
        };
      }
    );

    await mockFetcher.fetchItem("test", "tools");
    await mockFetcher.fetchItem("test", "tools");
    expect(callCount).toBe(1);
  });
});
