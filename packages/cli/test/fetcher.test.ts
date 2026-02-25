import { describe, test, expect } from "bun:test";
import { RegistryFetcher } from "../src/registry/fetcher.js";

const registries = {
  "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
  "@acme": "https://acme.example.com/r/{type}/{name}.json",
};

describe("RegistryFetcher", () => {
  test("resolves URL for default namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@kitn");
    expect(url).toBe("https://kitn.example.com/r/agents/weather-agent.json");
  });

  test("resolves URL with version", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@kitn", "1.0.0");
    expect(url).toBe("https://kitn.example.com/r/agents/weather-agent@1.0.0.json");
  });

  test("resolves URL for third-party namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents", "@acme");
    expect(url).toBe("https://acme.example.com/r/agents/weather-agent.json");
  });

  test("defaults to @kitn when namespace omitted", () => {
    const fetcher = new RegistryFetcher(registries);
    const url = fetcher.resolveUrl("weather-agent", "agents");
    expect(url).toBe("https://kitn.example.com/r/agents/weather-agent.json");
  });

  test("throws for unknown namespace", () => {
    const fetcher = new RegistryFetcher(registries);
    expect(() => fetcher.resolveUrl("test", "agents", "@unknown")).toThrow("No registry configured for @unknown");
  });
});
