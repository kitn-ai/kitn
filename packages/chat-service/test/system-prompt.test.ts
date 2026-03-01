import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/prompts/system.js";

describe("buildSystemPrompt", () => {
  test("includes registry components in prompt", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [
        {
          name: "weather-tool",
          type: "tool",
          description: "Fetch current weather data",
          registryDependencies: ["weather-api"],
        },
        {
          name: "general-agent",
          type: "agent",
          description: "A general-purpose assistant agent",
        },
      ],
      installed: [],
    });

    expect(prompt).toContain("weather-tool");
    expect(prompt).toContain("[tool]");
    expect(prompt).toContain("Fetch current weather data");
    expect(prompt).toContain("general-agent");
    expect(prompt).toContain("[agent]");
    expect(prompt).toContain("A general-purpose assistant agent");
  });

  test("includes installed components", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: ["weather-tool", "general-agent", "echo-tool"],
    });

    expect(prompt).toContain("weather-tool");
    expect(prompt).toContain("general-agent");
    expect(prompt).toContain("echo-tool");
  });

  test("includes role and constraints", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
    });

    expect(prompt).toContain("kitn assistant");
    expect(prompt).toContain("createPlan");
  });

  test("includes global registry components when provided", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
      globalRegistryIndex: [
        {
          namespace: "@community",
          url: "https://community.example.com/r/{type}/{name}.json",
          items: [
            {
              name: "sentiment-tool",
              type: "kitn:tool",
              description: "Analyze sentiment of text",
            },
            {
              name: "translate-tool",
              type: "kitn:tool",
              description: "Translate text between languages",
              registryDependencies: ["core"],
            },
          ],
        },
      ],
    });

    expect(prompt).toContain("@community");
    expect(prompt).toContain("sentiment-tool");
    expect(prompt).toContain("Analyze sentiment of text");
    expect(prompt).toContain("translate-tool");
    expect(prompt).toContain("(depends on: core)");
    expect(prompt).toContain("Components from Other Registries");
    expect(prompt).toContain("registry-add");
  });

  test("omits global registry section when empty", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
      globalRegistryIndex: [],
    });

    // The heading should not appear — the instruction text may reference it
    expect(prompt).not.toContain("## Components from Other Registries");
  });

  test("omits global registry section when undefined", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
    });

    expect(prompt).not.toContain("## Components from Other Registries");
  });

  test("includes registry-add in constraints", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
    });

    expect(prompt).toContain("registry-add");
    expect(prompt).toContain("registry-adds first");
  });

  test("includes no-hallucination constraint", () => {
    const prompt = buildSystemPrompt({
      registryIndex: [],
      installed: [],
    });

    expect(prompt).toContain("ONLY use \"add\" for components that are explicitly listed above");
    expect(prompt).toContain("do not invent component names");
  });
});
