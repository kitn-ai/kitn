import { describe, test, expect } from "bun:test";
import { askUserTool, writeFileTool, readFileTool, listFilesTool, updateEnvTool } from "../src/tools/tools.js";
import { createPlanTool } from "../src/tools/create-plan.js";

describe("askUserTool", () => {
  test("validates option item with choices", () => {
    const input = {
      items: [{ type: "option", text: "Pick an API", choices: ["OpenWeatherMap", "WeatherAPI"] }],
    };
    const parsed = askUserTool.parameters.parse(input);
    expect(parsed.items[0].type).toBe("option");
    expect(parsed.items[0].choices).toHaveLength(2);
  });

  test("validates question item without choices", () => {
    const input = {
      items: [{ type: "question", text: "What is your project name?" }],
    };
    const parsed = askUserTool.parameters.parse(input);
    expect(parsed.items[0].type).toBe("question");
  });

  test("validates info item", () => {
    const input = {
      items: [{ type: "info", text: "Checking available components..." }],
    };
    const parsed = askUserTool.parameters.parse(input);
    expect(parsed.items[0].type).toBe("info");
  });

  test("rejects invalid type", () => {
    const input = {
      items: [{ type: "invalid", text: "bad" }],
    };
    expect(() => askUserTool.parameters.parse(input)).toThrow();
  });
});

describe("writeFileTool", () => {
  test("validates path and content", () => {
    const input = { path: "src/agents/weather-agent.ts", content: "export const x = 1;", description: "Weather agent" };
    const parsed = writeFileTool.parameters.parse(input);
    expect(parsed.path).toBe("src/agents/weather-agent.ts");
    expect(parsed.content).toContain("export");
    expect(parsed.description).toBe("Weather agent");
  });

  test("description is optional", () => {
    const input = { path: "test.ts", content: "code" };
    const parsed = writeFileTool.parameters.parse(input);
    expect(parsed.description).toBeUndefined();
  });
});

describe("readFileTool", () => {
  test("validates path", () => {
    const input = { path: "src/agents/weather-agent.ts" };
    const parsed = readFileTool.parameters.parse(input);
    expect(parsed.path).toBe("src/agents/weather-agent.ts");
  });
});

describe("listFilesTool", () => {
  test("validates pattern and directory", () => {
    const input = { pattern: "*.ts", directory: "src/agents" };
    const parsed = listFilesTool.parameters.parse(input);
    expect(parsed.pattern).toBe("*.ts");
    expect(parsed.directory).toBe("src/agents");
  });

  test("directory is optional", () => {
    const input = { pattern: "**/*.ts" };
    const parsed = listFilesTool.parameters.parse(input);
    expect(parsed.directory).toBeUndefined();
  });
});

describe("updateEnvTool", () => {
  test("validates key and description", () => {
    const input = { key: "OPENWEATHER_API_KEY", description: "Your OpenWeatherMap API key" };
    const parsed = updateEnvTool.parameters.parse(input);
    expect(parsed.key).toBe("OPENWEATHER_API_KEY");
    expect(parsed.description).toBe("Your OpenWeatherMap API key");
  });
});

describe("createPlanTool", () => {
  test("validates update action", () => {
    const input = {
      summary: "Update weather tool",
      steps: [{ action: "update", component: "weather-tool", reason: "Update to latest" }],
    };
    const parsed = createPlanTool.parameters.parse(input);
    expect(parsed.steps[0].action).toBe("update");
  });

  test("still validates existing actions", () => {
    const input = {
      summary: "Test plan",
      steps: [
        { action: "add", component: "x", reason: "test" },
        { action: "create", type: "agent", name: "y", reason: "test" },
        { action: "registry-add", namespace: "@test", url: "http://test.com", reason: "test" },
      ],
    };
    const parsed = createPlanTool.parameters.parse(input);
    expect(parsed.steps).toHaveLength(3);
  });
});
