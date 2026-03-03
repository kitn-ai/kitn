import { describe, test, expect } from "bun:test";
import { parseConfig } from "../src/config/schema.js";

describe("config", () => {
  test("parses valid config with provider", () => {
    const config = parseConfig({
      provider: { type: "openrouter", apiKey: "test-key" },
      model: "anthropic/claude-sonnet-4-5",
    });
    expect(config.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.provider?.type).toBe("openrouter");
    expect(config.provider?.apiKey).toBe("test-key");
  });

  test("applies defaults for empty config", () => {
    const config = parseConfig({});
    expect(config.model).toBe("openai/gpt-4o-mini");
    expect(config.channels.terminal.enabled).toBe(true);
    expect(config.permissions.trusted).toEqual([]);
    expect(config.permissions.denied).toEqual([]);
    expect(config.gateway.port).toBe(18800);
    expect(config.gateway.bind).toBe("loopback");
  });

  test("applies default registries", () => {
    const config = parseConfig({});
    expect(config.registries["@kitn"]).toBeDefined();
  });

  test("rejects invalid provider type", () => {
    expect(() =>
      parseConfig({ provider: { type: "invalid" } }),
    ).toThrow();
  });

  test("parses discord channel config", () => {
    const config = parseConfig({
      channels: {
        discord: { token: "discord-token-123" },
      },
    });
    expect(config.channels.discord?.token).toBe("discord-token-123");
    expect(config.channels.discord?.enabled).toBe(true);
  });

  test("parses MCP servers", () => {
    const config = parseConfig({
      mcpServers: {
        kitn: { command: "kitn", args: ["mcp"] },
      },
    });
    expect(config.mcpServers.kitn.command).toBe("kitn");
    expect(config.mcpServers.kitn.args).toEqual(["mcp"]);
  });

  test("parses permissions", () => {
    const config = parseConfig({
      permissions: {
        trusted: ["file-read", "web-search"],
        denied: ["bash"],
      },
    });
    expect(config.permissions.trusted).toEqual(["file-read", "web-search"]);
    expect(config.permissions.denied).toEqual(["bash"]);
  });

  test("provider is optional", () => {
    const config = parseConfig({});
    expect(config.provider).toBeUndefined();
  });
});
