import { describe, test, expect } from "bun:test";
import { buildCompactionPrompt } from "../src/prompts/compact.js";

describe("buildCompactionPrompt", () => {
  test("instructs to preserve decisions and file paths", () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain("decisions");
    expect(prompt).toContain("File paths");
    expect(prompt).toContain("Environment variable");
  });

  test("instructs to exclude secrets", () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain("secret");
    expect(prompt).toContain("password");
    expect(prompt).toContain("API key value");
  });

  test("instructs to preserve component relationships", () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain("component");
    expect(prompt).toContain("link");
  });

  test("instructs to start with summary prefix", () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain("Previous conversation summary:");
  });
});
