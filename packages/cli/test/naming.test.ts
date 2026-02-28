import { describe, test, expect } from "bun:test";
import { toCamelCase, toTitleCase } from "../src/utils/naming.js";

describe("toCamelCase", () => {
  test("converts kebab-case to camelCase", () => {
    expect(toCamelCase("weather-tool")).toBe("weatherTool");
  });

  test("handles multiple hyphens", () => {
    expect(toCamelCase("my-cool-tool")).toBe("myCoolTool");
  });

  test("returns single word unchanged", () => {
    expect(toCamelCase("weather")).toBe("weather");
  });

  test("handles empty string", () => {
    expect(toCamelCase("")).toBe("");
  });

  test("does not modify already camelCase", () => {
    expect(toCamelCase("weatherTool")).toBe("weatherTool");
  });
});

describe("toTitleCase", () => {
  test("converts kebab-case to Title Case", () => {
    expect(toTitleCase("my-skill")).toBe("My Skill");
  });

  test("handles single word", () => {
    expect(toTitleCase("weather")).toBe("Weather");
  });

  test("handles multiple words", () => {
    expect(toTitleCase("my-cool-agent")).toBe("My Cool Agent");
  });

  test("handles empty string", () => {
    expect(toTitleCase("")).toBe("");
  });
});
