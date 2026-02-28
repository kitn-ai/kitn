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
});
