import { describe, test, expect } from "bun:test";
import {
  linkToolToAgent,
  unlinkToolFromAgent,
} from "../src/installers/agent-linker.js";

const BASIC_AGENT = `import { registerAgent } from "@kitn/core";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "weather-agent",
  description: "",
  system: SYSTEM_PROMPT,
  tools: {},
});
`;

const AGENT_WITH_TOOL = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "weather-agent",
  description: "",
  system: SYSTEM_PROMPT,
  tools: { weatherTool },
});
`;

const AGENT_WITH_MULTILINE_TOOLS = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";
import { calculatorTool } from "../tools/calculator.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "multi-agent",
  description: "",
  system: SYSTEM_PROMPT,
  tools: {
    getWeather: weatherTool,
    calculate: calculatorTool,
  },
});
`;

const tool = {
  exportName: "weatherTool",
  importPath: "../tools/weather.js",
};

const calcTool = {
  exportName: "calculatorTool",
  importPath: "../tools/calculator.js",
};

describe("linkToolToAgent", () => {
  test("links tool to empty tools: {}", () => {
    const result = linkToolToAgent(BASIC_AGENT, tool);
    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(
      'import { weatherTool } from "../tools/weather.js";',
    );
    expect(result.content).toContain("tools: { weatherTool }");
  });

  test("links tool to agent with existing tools (single-line)", () => {
    const result = linkToolToAgent(AGENT_WITH_TOOL, calcTool);
    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(
      'import { calculatorTool } from "../tools/calculator.js";',
    );
    expect(result.content).toContain("tools: { weatherTool, calculatorTool }");
  });

  test("links tool to agent with existing multiline tools", () => {
    const newTool = {
      exportName: "echoTool",
      importPath: "../tools/echo.js",
    };
    const result = linkToolToAgent(AGENT_WITH_MULTILINE_TOOLS, newTool);
    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(
      'import { echoTool } from "../tools/echo.js";',
    );
    expect(result.content).toContain("echoTool,");
    // Should maintain multiline format
    expect(result.content).toContain("getWeather: weatherTool,");
  });

  test("links tool with custom --as key", () => {
    const result = linkToolToAgent(BASIC_AGENT, tool, "getWeather");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("tools: { getWeather: weatherTool }");
  });

  test("is idempotent — already linked", () => {
    const result = linkToolToAgent(AGENT_WITH_TOOL, tool);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(AGENT_WITH_TOOL);
  });

  test("is idempotent — already linked with custom key", () => {
    const agentWithCustomKey = BASIC_AGENT.replace(
      "tools: {}",
      "tools: { getWeather: weatherTool }",
    );
    const content = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "weather-agent",
  description: "",
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
});
`;
    const result = linkToolToAgent(content, tool, "getWeather");
    expect(result.changed).toBe(false);
  });

  test("import is inserted after last import line", () => {
    const result = linkToolToAgent(BASIC_AGENT, tool);
    const lines = result.content.split("\n");
    const coreImportIdx = lines.findIndex((l) =>
      l.includes("@kitn/core"),
    );
    const toolImportIdx = lines.findIndex((l) =>
      l.includes("weatherTool"),
    );
    expect(toolImportIdx).toBe(coreImportIdx + 1);
  });

  test("returns error for unparseable file (no tools block)", () => {
    const noTools = `import { registerAgent } from "@kitn/core";

registerAgent({
  name: "agent",
});
`;
    const result = linkToolToAgent(noTools, tool);
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Could not auto-modify");
    expect(result.error).toContain("weatherTool");
  });
});

describe("unlinkToolFromAgent", () => {
  test("unlinks last tool → tools: {}", () => {
    const result = unlinkToolFromAgent(AGENT_WITH_TOOL, tool);
    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain("tools: {}");
    expect(result.content).not.toContain("weatherTool");
    expect(result.content).not.toContain("../tools/weather.js");
  });

  test("unlinks one of multiple tools (single-line)", () => {
    // Start with two tools
    const twoTools = linkToolToAgent(AGENT_WITH_TOOL, calcTool);
    expect(twoTools.changed).toBe(true);

    const result = unlinkToolFromAgent(twoTools.content, tool);
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("weatherTool");
    expect(result.content).toContain("calculatorTool");
    expect(result.content).toContain("tools: { calculatorTool }");
  });

  test("unlinks one of multiple tools (multiline)", () => {
    const result = unlinkToolFromAgent(
      AGENT_WITH_MULTILINE_TOOLS,
      calcTool,
      "calculate",
    );
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("calculatorTool");
    expect(result.content).not.toContain("../tools/calculator.js");
    expect(result.content).toContain("getWeather: weatherTool,");
  });

  test("removes import when unreferenced", () => {
    const result = unlinkToolFromAgent(AGENT_WITH_TOOL, tool);
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("../tools/weather.js");
  });

  test("keeps import if still referenced elsewhere in the file", () => {
    const agentWithExtraRef = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";

// weatherTool is also used here for validation
const validateTool = weatherTool;

registerAgent({
  name: "weather-agent",
  description: "",
  system: SYSTEM_PROMPT,
  tools: { weatherTool },
});
`;
    const result = unlinkToolFromAgent(agentWithExtraRef, tool);
    expect(result.changed).toBe(true);
    expect(result.content).toContain("tools: {}");
    // Import should remain because weatherTool is still referenced
    expect(result.content).toContain(
      'import { weatherTool } from "../tools/weather.js";',
    );
  });

  test("is idempotent — tool not present", () => {
    const result = unlinkToolFromAgent(BASIC_AGENT, tool);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(BASIC_AGENT);
  });

  test("returns error for unparseable file (no tools block)", () => {
    const noTools = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";

registerAgent({
  name: "agent",
});
`;
    // hasToolEntry returns false since there's no tools block → changed: false
    const result = unlinkToolFromAgent(noTools, tool);
    expect(result.changed).toBe(false);
  });
});

describe("edge cases", () => {
  test("handles tools with key: value syntax in single-line", () => {
    const agent = `import { registerAgent } from "@kitn/core";
import { weatherTool } from "../tools/weather.js";

registerAgent({
  name: "agent",
  tools: { getWeather: weatherTool },
});
`;
    // Link another tool
    const result = linkToolToAgent(agent, calcTool, "calc");
    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      "tools: { getWeather: weatherTool, calc: calculatorTool }",
    );
  });

  test("handles agent file without registerAgent (export config pattern)", () => {
    const configAgent = `import { weatherTool } from "../tools/weather.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";

export const WEATHER_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
};
`;
    const result = linkToolToAgent(configAgent, calcTool, "calc");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("calc: calculatorTool");
  });

  test("link then unlink returns to near-original state", () => {
    const linked = linkToolToAgent(BASIC_AGENT, tool);
    expect(linked.changed).toBe(true);
    const unlinked = unlinkToolFromAgent(linked.content, tool);
    expect(unlinked.changed).toBe(true);
    // Should be back to empty tools
    expect(unlinked.content).toContain("tools: {}");
    expect(unlinked.content).not.toContain("weatherTool");
  });

  test("handles file with no imports at all", () => {
    const noImports = `const config = {
  tools: {},
};
`;
    const result = linkToolToAgent(noImports, tool);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      'import { weatherTool } from "../tools/weather.js";',
    );
    expect(result.content).toContain("tools: { weatherTool }");
    // Import should be at the top
    expect(result.content.startsWith("import")).toBe(true);
  });
});
