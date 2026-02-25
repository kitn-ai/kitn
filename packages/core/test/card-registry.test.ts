/**
 * CardRegistry tests.
 * Run with: bun test packages/core/test/card-registry.test.ts
 */
import { describe, test, expect } from "bun:test";
import { CardRegistry } from "../src/utils/card-registry.js";

describe("CardRegistry", () => {
  test("extracts a card from matching tool result", () => {
    const registry = new CardRegistry();

    registry.register((toolName, result: any) => {
      if (toolName === "getWeather" && result?.location) {
        return { type: "weather", data: result };
      }
      return null;
    });

    const cards = registry.extract("getWeather", { location: "Tokyo", temp: 22 });
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("weather");
    expect(cards[0].data).toEqual({ location: "Tokyo", temp: 22 });
  });

  test("returns empty array for non-matching tool", () => {
    const registry = new CardRegistry();

    registry.register((toolName, result: any) => {
      if (toolName === "getWeather" && result?.location) {
        return { type: "weather", data: result };
      }
      return null;
    });

    expect(registry.extract("otherTool", { foo: "bar" })).toHaveLength(0);
  });

  test("unsubscribe removes the extractor", () => {
    const registry = new CardRegistry();

    const unsub = registry.register((toolName, result: any) => {
      if (toolName === "getWeather" && result?.location) {
        return { type: "weather", data: result };
      }
      return null;
    });

    unsub();
    expect(registry.extract("getWeather", { location: "Tokyo" })).toHaveLength(0);
  });

  test("multiple extractors can return cards from the same tool", () => {
    const registry = new CardRegistry();

    registry.register((toolName) => {
      if (toolName === "search") return { type: "web-result", data: {} };
      return null;
    });

    registry.register((toolName) => {
      if (toolName === "search") return { type: "suggestion", data: {} };
      return null;
    });

    const cards = registry.extract("search", {});
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.type)).toContain("web-result");
    expect(cards.map((c) => c.type)).toContain("suggestion");
  });
});
