import { describe, test, expect } from "bun:test";
import { collectEnvVars } from "../src/installers/env-writer.js";

describe("collectEnvVars", () => {
  test("merges envVars from multiple items", () => {
    const result = collectEnvVars([
      { envVars: { API_KEY: { description: "API key", required: true } } },
      { envVars: { DB_URL: { description: "Database URL", secret: false } } },
    ]);
    expect(Object.keys(result)).toEqual(["API_KEY", "DB_URL"]);
    expect(result.API_KEY.description).toBe("API key");
    expect(result.DB_URL.description).toBe("Database URL");
  });

  test("later items override earlier for same key", () => {
    const result = collectEnvVars([
      { envVars: { API_KEY: { description: "Old description" } } },
      { envVars: { API_KEY: { description: "New description", url: "https://example.com" } } },
    ]);
    expect(result.API_KEY.description).toBe("New description");
    expect(result.API_KEY.url).toBe("https://example.com");
  });

  test("skips items without envVars", () => {
    const result = collectEnvVars([
      { envVars: { KEY: { description: "A key" } } },
      {},
      { envVars: { OTHER: { description: "Other" } } },
    ]);
    expect(Object.keys(result)).toEqual(["KEY", "OTHER"]);
  });

  test("returns empty object when no items have envVars", () => {
    const result = collectEnvVars([{}, {}, {}]);
    expect(result).toEqual({});
  });
});
