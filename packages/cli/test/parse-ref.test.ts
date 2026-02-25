import { describe, test, expect } from "bun:test";
import { parseComponentRef } from "../src/utils/parse-ref.js";

describe("parseComponentRef", () => {
  test("plain name defaults to @kitn namespace, no version", () => {
    const ref = parseComponentRef("weather-agent");
    expect(ref).toEqual({ namespace: "@kitn", name: "weather-agent", version: undefined });
  });

  test("name with version", () => {
    const ref = parseComponentRef("weather-agent@1.0.0");
    expect(ref).toEqual({ namespace: "@kitn", name: "weather-agent", version: "1.0.0" });
  });

  test("namespaced name", () => {
    const ref = parseComponentRef("@acme/weather-agent");
    expect(ref).toEqual({ namespace: "@acme", name: "weather-agent", version: undefined });
  });

  test("namespaced name with version", () => {
    const ref = parseComponentRef("@acme/weather-agent@2.0.0");
    expect(ref).toEqual({ namespace: "@acme", name: "weather-agent", version: "2.0.0" });
  });

  test("semver with pre-release", () => {
    const ref = parseComponentRef("agent@1.0.0-beta.1");
    expect(ref).toEqual({ namespace: "@kitn", name: "agent", version: "1.0.0-beta.1" });
  });

  test("throws on bare @namespace without slash", () => {
    expect(() => parseComponentRef("@acme")).toThrow("Invalid component reference");
  });
});
