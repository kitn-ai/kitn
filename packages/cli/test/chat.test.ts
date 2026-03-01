import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveServiceUrl, buildServicePayload, formatPlan, fetchGlobalRegistries, validatePlan } from "../src/commands/chat.js";
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

  test("returns default URL when no config", async () => {
    expect(await resolveServiceUrl()).toBe("https://chat.kitn.dev");
  });

  test("returns config URL when set", async () => {
    expect(await resolveServiceUrl(undefined, { url: "http://localhost:4002" })).toBe("http://localhost:4002");
  });

  test("prefers KITN_CHAT_URL env var", async () => {
    process.env.KITN_CHAT_URL = "http://custom:9000";
    expect(await resolveServiceUrl(undefined, { url: "http://localhost:4002" })).toBe("http://custom:9000");
  });

  test("uses env var over default when no config", async () => {
    process.env.KITN_CHAT_URL = "http://env-only:8080";
    expect(await resolveServiceUrl()).toBe("http://env-only:8080");
  });

  test("urlOverride takes highest priority", async () => {
    process.env.KITN_CHAT_URL = "http://env:9000";
    expect(await resolveServiceUrl("http://flag:3000", { url: "http://config:4002" })).toBe("http://flag:3000");
  });
});

describe("buildServicePayload", () => {
  test("returns messages array and metadata", () => {
    const metadata = { registryIndex: [], installed: ["weather-agent"] };
    const messages = [{ role: "user" as const, content: "add a weather tool" }];
    const result = buildServicePayload(messages, metadata);
    expect(result).toEqual({
      messages: [{ role: "user", content: "add a weather tool" }],
      metadata: { registryIndex: [], installed: ["weather-agent"] },
    });
  });

  test("handles empty metadata", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const result = buildServicePayload(messages, {});
    expect(result).toEqual({ messages: [{ role: "user", content: "hello" }], metadata: {} });
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

  test("formats registry-add steps", () => {
    const plan: ChatPlan = {
      summary: "Add community registry and install sentiment tool",
      steps: [
        {
          action: "registry-add",
          namespace: "@community",
          url: "https://community.example.com/r/{type}/{name}.json",
          reason: "Need access to community components",
        },
        { action: "add", component: "@community/sentiment-tool", reason: "User wants sentiment analysis" },
      ],
    };
    const output = formatPlan(plan);
    expect(output).toContain("@community");
    expect(output).toContain("sentiment-tool");
    expect(output).toContain("1.");
    expect(output).toContain("2.");
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

describe("validatePlan", () => {
  const available = ["weather-tool", "weather-agent", "core", "hono"];
  const installed = ["core", "hono"];

  test("accepts valid add for available, non-installed component", () => {
    const plan: ChatPlan = {
      summary: "Add weather",
      steps: [{ action: "add", component: "weather-tool", reason: "Need weather" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("rejects add for non-existent component", () => {
    const plan: ChatPlan = {
      summary: "Add sentiment",
      steps: [{ action: "add", component: "sentiment-agent", reason: "Need sentiment" }],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("does not exist in the registry");
    expect(errors[0]).toContain("create");
  });

  test("rejects add for already-installed component", () => {
    const plan: ChatPlan = {
      summary: "Add core",
      steps: [{ action: "add", component: "core", reason: "Need core" }],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("already installed");
  });

  test("accepts create for custom components", () => {
    const plan: ChatPlan = {
      summary: "Create custom agent",
      steps: [{ action: "create", type: "agent", name: "sentiment-agent", reason: "Custom" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("rejects update for non-installed component", () => {
    const plan: ChatPlan = {
      summary: "Update weather tool",
      steps: [{ action: "update", component: "weather-tool", reason: "Update" }],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not installed");
  });

  test("accepts update for installed component", () => {
    const plan: ChatPlan = {
      summary: "Update core",
      steps: [{ action: "update", component: "core", reason: "Update" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });
});

describe("buildServicePayload with model", () => {
  test("includes model when provided", () => {
    const result = buildServicePayload(
      [{ role: "user" as const, content: "hello" }],
      {},
      "openai/gpt-4o-mini",
    );
    expect(result.model).toBe("openai/gpt-4o-mini");
  });

  test("omits model when not provided", () => {
    const result = buildServicePayload(
      [{ role: "user" as const, content: "hello" }],
      {},
    );
    expect(result).not.toHaveProperty("model");
  });
});

describe("fetchGlobalRegistries", () => {
  test("returns empty array when all registries are already configured", async () => {
    // @kitn is the only entry in the global directory, and it's typically configured
    const result = await fetchGlobalRegistries(["@kitn"]);
    expect(result).toEqual([]);
  });

  test("returns empty array on network failure", async () => {
    // Mock by using a non-existent configured namespace — the function handles errors gracefully
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("Network error"));
    try {
      const result = await fetchGlobalRegistries([]);
      expect(result).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("filters out configured namespaces from global directory", async () => {
    const mockDirectory = [
      { name: "@kitn", url: "https://kitn.example.com/r/{type}/{name}.json" },
      { name: "@community", url: "https://community.example.com/r/{type}/{name}.json" },
    ];
    const mockIndex = {
      version: "1.0.0",
      items: [
        { name: "test-tool", type: "kitn:tool", description: "A test tool" },
      ],
    };

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      fetchCount++;
      if (url.includes("registries.json")) {
        return new Response(JSON.stringify(mockDirectory));
      }
      if (url.includes("community.example.com") && url.includes("registry.json")) {
        return new Response(JSON.stringify(mockIndex));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await fetchGlobalRegistries(["@kitn"]);
      expect(result).toHaveLength(1);
      expect(result[0].namespace).toBe("@community");
      expect(result[0].url).toBe("https://community.example.com/r/{type}/{name}.json");
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].name).toBe("test-tool");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("skips registries whose index fetch fails", async () => {
    const mockDirectory = [
      { name: "@failing", url: "https://failing.example.com/r/{type}/{name}.json" },
      { name: "@working", url: "https://working.example.com/r/{type}/{name}.json" },
    ];
    const mockIndex = {
      version: "1.0.0",
      items: [
        { name: "good-tool", type: "kitn:tool", description: "A working tool" },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes("registries.json")) {
        return new Response(JSON.stringify(mockDirectory));
      }
      if (url.includes("failing.example.com")) {
        return new Response("Server error", { status: 500 });
      }
      if (url.includes("working.example.com") && url.includes("registry.json")) {
        return new Response(JSON.stringify(mockIndex));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await fetchGlobalRegistries([]);
      expect(result).toHaveLength(1);
      expect(result[0].namespace).toBe("@working");
      expect(result[0].items[0].name).toBe("good-tool");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
