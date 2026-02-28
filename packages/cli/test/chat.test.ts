import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveServiceUrl, buildRequestPayload, formatPlan } from "../src/commands/chat.js";
import type { ChatPlan } from "../src/commands/chat-types.js";

describe("resolveServiceUrl", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.KITN_CHAT_URL;
    delete process.env.KITN_CHAT_URL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KITN_CHAT_URL = originalEnv;
    } else {
      delete process.env.KITN_CHAT_URL;
    }
  });

  test("returns default URL when no config", () => {
    expect(resolveServiceUrl(undefined)).toBe("https://chat.kitn.dev");
  });

  test("returns config URL when set", () => {
    expect(resolveServiceUrl({ url: "http://localhost:4002" })).toBe("http://localhost:4002");
  });

  test("prefers KITN_CHAT_URL env var", () => {
    process.env.KITN_CHAT_URL = "http://custom:9000";
    expect(resolveServiceUrl({ url: "http://localhost:4002" })).toBe("http://custom:9000");
  });

  test("uses env var over default when no config", () => {
    process.env.KITN_CHAT_URL = "http://env-only:8080";
    expect(resolveServiceUrl(undefined)).toBe("http://env-only:8080");
  });
});

describe("buildRequestPayload", () => {
  test("returns message and metadata", () => {
    const metadata = { registryIndex: [], installed: ["weather-agent"] };
    const result = buildRequestPayload("add a weather tool", metadata);
    expect(result).toEqual({
      message: "add a weather tool",
      metadata: { registryIndex: [], installed: ["weather-agent"] },
    });
  });

  test("handles empty metadata", () => {
    const result = buildRequestPayload("hello", {});
    expect(result).toEqual({ message: "hello", metadata: {} });
  });
});

describe("formatPlan", () => {
  test("formats add steps", () => {
    const plan: ChatPlan = {
      summary: "Install the weather tool",
      steps: [
        { action: "add", component: "weather-tool", reason: "Provides weather data" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("Install the weather tool");
    expect(output).toContain("weather-tool");
    expect(output).toContain("Provides weather data");
    expect(output).toContain("1.");
  });

  test("formats create steps", () => {
    const plan: ChatPlan = {
      summary: "Create a custom agent",
      steps: [
        { action: "create", type: "agent", name: "my-agent", reason: "Custom agent needed" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("Create a custom agent");
    expect(output).toContain("agent");
    expect(output).toContain("my-agent");
    expect(output).toContain("Custom agent needed");
  });

  test("formats link steps", () => {
    const plan: ChatPlan = {
      summary: "Wire tools to agents",
      steps: [
        { action: "link", toolName: "weather-tool", agentName: "general-agent", reason: "Agent needs weather data" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("Wire tools to agents");
    expect(output).toContain("weather-tool");
    expect(output).toContain("general-agent");
    expect(output).toContain("Agent needs weather data");
  });

  test("formats remove steps", () => {
    const plan: ChatPlan = {
      summary: "Remove unused components",
      steps: [
        { action: "remove", component: "old-tool", reason: "No longer needed" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("Remove unused components");
    expect(output).toContain("old-tool");
    expect(output).toContain("No longer needed");
  });

  test("formats unlink steps", () => {
    const plan: ChatPlan = {
      summary: "Disconnect tool from agent",
      steps: [
        { action: "unlink", toolName: "echo-tool", agentName: "general-agent", reason: "Tool no longer used by this agent" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("Disconnect tool from agent");
    expect(output).toContain("echo-tool");
    expect(output).toContain("general-agent");
    expect(output).toContain("Tool no longer used by this agent");
  });

  test("formats multiple steps with numbering", () => {
    const plan: ChatPlan = {
      summary: "Set up weather features",
      steps: [
        { action: "add", component: "weather-tool", reason: "Provides weather data" },
        { action: "add", component: "weather-agent", reason: "Handles weather queries" },
        { action: "link", toolName: "weather-tool", agentName: "weather-agent", reason: "Wire tool to agent" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("3.");
  });
});
