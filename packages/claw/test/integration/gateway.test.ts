import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Integration tests for the KitnClaw gateway components.
 * Uses temp directories to avoid touching the real ~/.kitnclaw/.
 */

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "claw-integration-"));
  await mkdir(join(tmpHome, "sessions"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

function makeTestConfig() {
  const { parseConfig } = require("../../src/config/schema.js");
  return parseConfig({
    provider: { type: "openai", apiKey: "test-key" },
    model: "gpt-4o-mini",
  });
}

describe("gateway integration", () => {
  describe("config → plugin creation", () => {
    test("createClawPlugin produces a valid PluginContext", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);

      expect(plugin.agents).toBeDefined();
      expect(plugin.tools).toBeDefined();
      expect(plugin.cards).toBeDefined();
      expect(plugin.storage).toBeDefined();
      expect(plugin.model).toBeDefined();
      expect(plugin.hooks).toBeDefined();
      expect(typeof plugin.model).toBe("function");
    });

    test("plugin has lifecycle hooks at trace level", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);

      // Hooks should support on/emit
      expect(typeof plugin.hooks!.on).toBe("function");
      expect(typeof plugin.hooks!.emit).toBe("function");

      // Verify trace-level events fire
      let captured = false;
      const unsub = plugin.hooks!.on("tool:execute", () => {
        captured = true;
      });

      plugin.hooks!.emit("tool:execute", {
        agentName: "test",
        toolName: "test-tool",
        input: {},
        output: "ok",
        duration: 0,
        conversationId: "",
        timestamp: Date.now(),
      });

      expect(captured).toBe(true);
      unsub();
    });
  });

  describe("tool registration", () => {
    test("registerBuiltinTools registers all 12 tools", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { registerBuiltinTools } = await import("../../src/tools/register-builtin.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);
      registerBuiltinTools(plugin);

      const tools = plugin.tools.list();
      expect(tools.length).toBe(12);

      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "bash",
        "create-agent",
        "create-tool",
        "file-read",
        "file-search",
        "file-write",
        "kitn-add",
        "kitn-registry-search",
        "memory-save",
        "memory-search",
        "web-fetch",
        "web-search",
      ]);
    });

    test("each tool has description and inputSchema", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { registerBuiltinTools } = await import("../../src/tools/register-builtin.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);
      registerBuiltinTools(plugin);

      for (const tool of plugin.tools.list()) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }
    });
  });

  describe("permissions + tools", () => {
    test("permission manager respects config", async () => {
      const { PermissionManager } = await import("../../src/permissions/manager.js");

      const pm = new PermissionManager({
        trusted: ["bash", "file-write"],
        requireConfirmation: [],
        denied: ["web-search"],
      });

      expect(pm.check("bash")).toBe("allow");
      expect(pm.check("file-write")).toBe("allow");
      expect(pm.check("web-search")).toBe("deny");
      expect(pm.check("file-read")).toBe("allow"); // safe by default
    });

    test("wrapped tools intercept denied tools", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { registerBuiltinTools } = await import("../../src/tools/register-builtin.js");
      const { PermissionManager } = await import("../../src/permissions/manager.js");
      const { wrapToolsWithPermissions } = await import("../../src/agent/wrapped-tools.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);
      registerBuiltinTools(plugin);

      const pm = new PermissionManager({
        trusted: [],
        requireConfirmation: [],
        denied: ["bash"],
      });

      const handler = {
        onConfirm: async () => "deny" as const,
      };

      const wrapped = wrapToolsWithPermissions(plugin, pm, handler);

      // bash should be denied
      expect(wrapped["bash"]).toBeDefined();
      const result = await wrapped["bash"].execute({ command: "echo hi" });
      expect(result).toEqual({ error: 'Tool "bash" is denied by configuration.' });
    });
  });

  describe("channel manager", () => {
    test("registers and retrieves channels", async () => {
      const { ChannelManager } = await import("../../src/channels/manager.js");
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { PermissionManager } = await import("../../src/permissions/manager.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);
      const pm = new PermissionManager(config.permissions);

      const cm = new ChannelManager({
        ctx: plugin,
        config,
        permissions: pm,
      });

      const mockChannel = {
        type: "test",
        start: async () => {},
        stop: async () => {},
        send: async () => {},
      };

      cm.register(mockChannel);
      expect(cm.getChannel("test")).toBe(mockChannel);
      expect(cm.getChannel("nonexistent")).toBeUndefined();
    });
  });

  describe("session store", () => {
    test("full conversation flow: append → get → clear", async () => {
      const { JsonlSessionStore } = await import("../../src/sessions/store.js");
      const sessionsDir = join(tmpHome, "sessions");
      const store = new JsonlSessionStore(sessionsDir);

      await store.append("sess-1", {
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      });

      await store.append("sess-1", {
        role: "assistant",
        content: "Hi there!",
        timestamp: new Date().toISOString(),
      });

      const conv = await store.get("sess-1");
      expect(conv).not.toBeNull();
      expect(conv!.messages).toHaveLength(2);
      expect(conv!.messages[0].content).toBe("Hello");
      expect(conv!.messages[1].content).toBe("Hi there!");

      const cleared = await store.clear("sess-1");
      expect(cleared.messages).toHaveLength(0);
    });
  });

  describe("system prompt", () => {
    test("includes base prompt, tools, and context", async () => {
      const { buildSystemPrompt } = await import("../../src/agent/system-prompt.js");
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { registerBuiltinTools } = await import("../../src/tools/register-builtin.js");
      const config = makeTestConfig();

      const plugin = createClawPlugin(config, tmpHome);
      registerBuiltinTools(plugin);

      const prompt = await buildSystemPrompt(plugin, config, "terminal");

      expect(prompt).toContain("KitnClaw");
      expect(prompt).toContain("file-read");
      expect(prompt).toContain("bash");
      expect(prompt).toContain("memory-search");
      expect(prompt).toContain("terminal");
      expect(prompt).toContain("gpt-4o-mini");
    });
  });

  describe("end-to-end wiring", () => {
    test("plugin + tools + permissions + channels work together", async () => {
      const { createClawPlugin } = await import("../../src/gateway/create-plugin.js");
      const { registerBuiltinTools } = await import("../../src/tools/register-builtin.js");
      const { PermissionManager } = await import("../../src/permissions/manager.js");
      const { ChannelManager } = await import("../../src/channels/manager.js");
      const { wrapToolsWithPermissions } = await import("../../src/agent/wrapped-tools.js");
      const { buildSystemPrompt } = await import("../../src/agent/system-prompt.js");
      const config = makeTestConfig();

      // 1. Create plugin
      const plugin = createClawPlugin(config, tmpHome);

      // 2. Register tools
      registerBuiltinTools(plugin);
      expect(plugin.tools.list().length).toBe(12);

      // 3. Create permissions
      const pm = new PermissionManager({
        trusted: ["file-read"],
        requireConfirmation: [],
        denied: ["bash"],
      });

      // 4. Create channel manager
      const cm = new ChannelManager({
        ctx: plugin,
        config,
        permissions: pm,
      });

      // 5. Register a mock channel
      const sentMessages: any[] = [];
      cm.register({
        type: "test-channel",
        start: async () => {},
        stop: async () => {},
        send: async (_sid, msg) => { sentMessages.push(msg); },
      });

      // 6. Verify system prompt is buildable
      const system = await buildSystemPrompt(plugin, config, "test-channel");
      expect(system).toContain("file-read");
      expect(system).toContain("test-channel");

      // 7. Verify permission-wrapped tools work
      const handler = { onConfirm: async () => "allow" as const };
      const wrapped = wrapToolsWithPermissions(plugin, pm, handler);
      expect(Object.keys(wrapped).length).toBe(12);

      // file-read should be allowed (trusted)
      // bash should be denied
      const bashResult = await wrapped["bash"].execute({ command: "echo test" });
      expect(bashResult.error).toContain("denied");
    });
  });
});
