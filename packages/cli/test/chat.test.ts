import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveServiceUrl, buildServicePayload, formatPlan, fetchGlobalRegistries, validatePlan, handleListFiles } from "../src/commands/chat.js";
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
  // Full registry: all 37 components from the real registry
  const available = [
    "coding-agent", "recipe-agent", "supervisor-agent", "human-in-loop-agent",
    "taskboard-agent", "knowledge-agent", "skills-agent", "weather-agent",
    "memory-agent", "guardrails-agent", "cron-manager-agent", "compact-agent",
    "hackernews-agent", "web-search-agent",
    "hackernews-tool", "movies-tool", "cron-tools", "web-search-tool",
    "weather-tool", "web-fetch-tool",
    "step-by-step-reasoning", "concise-summarizer", "fact-check", "eli5", "pros-and-cons",
    "memory-store", "conversation-store",
    "core", "hono-openapi", "mcp-server", "elysia", "hono", "mcp-client",
    "vercel-scheduler", "upstash-scheduler", "cloudflare-scheduler", "bullmq-scheduler",
  ];
  const installed = ["core", "hono", "weather-tool", "weather-agent"];

  // --- ADD action tests ---

  test("accepts valid add for available, non-installed component", () => {
    const plan: ChatPlan = {
      summary: "Add cron tools",
      steps: [{ action: "add", component: "cron-tools", reason: "Need cron" }],
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

  test("rejects add for multiple already-installed components", () => {
    const plan: ChatPlan = {
      summary: "Add things",
      steps: [
        { action: "add", component: "core", reason: "Need core" },
        { action: "add", component: "hono", reason: "Need hono" },
      ],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("core");
    expect(errors[1]).toContain("hono");
  });

  test("accepts add for multiple valid registry components", () => {
    const plan: ChatPlan = {
      summary: "Add cron setup",
      steps: [
        { action: "add", component: "cron-tools", reason: "Cron tools" },
        { action: "add", component: "cron-manager-agent", reason: "Cron agent" },
        { action: "add", component: "upstash-scheduler", reason: "Scheduler" },
      ],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- CREATE action tests ---

  test("accepts create for custom components", () => {
    const plan: ChatPlan = {
      summary: "Create custom agent",
      steps: [{ action: "create", type: "agent", name: "sentiment-agent", reason: "Custom" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("accepts create for any custom type", () => {
    const plan: ChatPlan = {
      summary: "Create custom tool",
      steps: [{ action: "create", type: "tool", name: "slack-notifier", reason: "Slack integration" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- UPDATE action tests ---

  test("rejects update for non-installed component", () => {
    const plan: ChatPlan = {
      summary: "Update recipe-agent",
      steps: [{ action: "update", component: "recipe-agent", reason: "Update" }],
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

  test("accepts update for installed tool", () => {
    const plan: ChatPlan = {
      summary: "Update weather-tool",
      steps: [{ action: "update", component: "weather-tool", reason: "Update" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- LINK action tests ---

  test("accepts link for installed tool to installed agent", () => {
    const plan: ChatPlan = {
      summary: "Link weather",
      steps: [{ action: "link", toolName: "weather-tool", agentName: "weather-agent", reason: "Wire" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("rejects link for tool that is not installed or being created", () => {
    const plan: ChatPlan = {
      summary: "Link unknown tool",
      steps: [{ action: "link", toolName: "nonexistent-tool", agentName: "weather-agent", reason: "Wire" }],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nonexistent-tool");
    expect(errors[0]).toContain("not installed or being added/created");
  });

  test("accepts link for tool being created in same plan", () => {
    const plan: ChatPlan = {
      summary: "Create and link",
      steps: [
        { action: "create", type: "tool", name: "custom-tool", reason: "New tool" },
        { action: "link", toolName: "custom-tool", agentName: "weather-agent", reason: "Wire" },
      ],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("accepts link for tool being added from registry in same plan", () => {
    const plan: ChatPlan = {
      summary: "Add and link",
      steps: [
        { action: "add", component: "hackernews-tool", reason: "HN tool" },
        { action: "link", toolName: "hackernews-tool", agentName: "weather-agent", reason: "Wire" },
      ],
    };
    // hackernews-tool is available but not installed, but it's being added in the plan
    // The link validation checks if tool is in available OR installed OR being created
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- REMOVE action tests ---

  test("accepts remove for any component (no validation needed)", () => {
    const plan: ChatPlan = {
      summary: "Remove weather",
      steps: [{ action: "remove", component: "weather-agent", reason: "Not needed" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- UNLINK action tests ---

  test("accepts unlink for any tool-agent pair", () => {
    const plan: ChatPlan = {
      summary: "Unlink",
      steps: [{ action: "unlink", toolName: "weather-tool", agentName: "weather-agent", reason: "Disconnect" }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- REGISTRY-ADD action tests ---

  test("accepts registry-add with namespace and url", () => {
    const plan: ChatPlan = {
      summary: "Add registry",
      steps: [{
        action: "registry-add",
        namespace: "@acme",
        url: "https://acme.com/r/{type}/{name}.json",
        reason: "External registry",
      }],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  // --- MULTI-STEP plan tests ---

  test("validates complex multi-step plan with mixed actions", () => {
    const plan: ChatPlan = {
      summary: "Full setup",
      steps: [
        { action: "add", component: "hackernews-tool", reason: "HN data" },
        { action: "add", component: "hackernews-agent", reason: "HN agent" },
        { action: "create", type: "tool", name: "custom-summarizer", reason: "Custom" },
        { action: "link", toolName: "hackernews-tool", agentName: "hackernews-agent", reason: "Wire" },
      ],
    };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("catches multiple errors across different action types", () => {
    const plan: ChatPlan = {
      summary: "Bad plan",
      steps: [
        { action: "add", component: "unicorn-tool", reason: "Magic" },
        { action: "add", component: "core", reason: "Already there" },
        { action: "update", component: "recipe-agent", reason: "Not installed" },
        { action: "link", toolName: "ghost-tool", agentName: "weather-agent", reason: "Wire" },
      ],
    };
    const errors = validatePlan(plan, available, installed);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("unicorn-tool");
    expect(errors[1]).toContain("core");
    expect(errors[2]).toContain("recipe-agent");
    expect(errors[3]).toContain("ghost-tool");
  });

  test("accepts empty plan", () => {
    const plan: ChatPlan = { summary: "Nothing", steps: [] };
    expect(validatePlan(plan, available, installed)).toEqual([]);
  });

  test("handles plan with add step missing component name", () => {
    const plan: ChatPlan = {
      summary: "Missing name",
      steps: [{ action: "add", reason: "No component" }],
    };
    // Should not crash — just skip validation for steps without component
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

// ---------------------------------------------------------------------------
// handleListFiles — path traversal and glob matching
// ---------------------------------------------------------------------------

describe("handleListFiles", () => {
  const cwd = process.cwd();

  test("rejects path traversal via ../", async () => {
    const result = await handleListFiles({ pattern: "*.ts", directory: "../../etc" }, cwd);
    expect(result).toContain("Rejected");
    expect(result).toContain("escape project directory");
  });

  test("allows subdirectory within project", async () => {
    const result = await handleListFiles({ pattern: "*.ts", directory: "packages/cli/src" }, cwd);
    expect(result).not.toContain("Rejected");
  });

  test("lists files without directory (uses cwd)", async () => {
    const result = await handleListFiles({ pattern: "*.json" }, cwd);
    // Should find at least package.json
    expect(result).toContain("package.json");
  });

  test("returns 'no files found' for non-matching pattern", async () => {
    const result = await handleListFiles({ pattern: "*.nonexistent_extension_xyz" }, cwd);
    expect(result).toContain("No files found");
  });

  test("handles non-existent directory gracefully", async () => {
    const result = await handleListFiles({ pattern: "*.ts", directory: "this_dir_does_not_exist_xyz" }, cwd);
    expect(result).toContain("Directory not found");
  });
});
