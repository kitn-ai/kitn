import { describe, test, expect } from "bun:test";
import { assistantGuard, COMPONENT_KEYWORDS, ACTION_KEYWORDS, STANDALONE_KEYWORDS } from "../src/agents/assistant.js";

describe("assistantGuard", () => {
  // --- Component + action keyword combinations ---

  test("allows component + action queries", async () => {
    expect((await assistantGuard("add a weather agent")).allowed).toBe(true);
    expect((await assistantGuard("create a new tool")).allowed).toBe(true);
    expect((await assistantGuard("remove the echo tool")).allowed).toBe(true);
  });

  test("allows standalone keywords", async () => {
    expect((await assistantGuard("what can you do")).allowed).toBe(true);
    expect((await assistantGuard("what's available")).allowed).toBe(true);
    expect((await assistantGuard("help me with kitn")).allowed).toBe(true);
  });

  // --- All component types ---

  test("allows agent-related queries", async () => {
    expect((await assistantGuard("I want an agent")).allowed).toBe(true);
    expect((await assistantGuard("set up the weather agent")).allowed).toBe(true);
  });

  test("allows tool-related queries", async () => {
    expect((await assistantGuard("I need a search tool")).allowed).toBe(true);
    expect((await assistantGuard("what tools are available")).allowed).toBe(true);
  });

  test("allows skill-related queries", async () => {
    expect((await assistantGuard("add a formal tone skill")).allowed).toBe(true);
  });

  test("allows rule-related queries", async () => {
    expect((await assistantGuard("generate rules for my project")).allowed).toBe(true);
    expect((await assistantGuard("set up claude.md rules")).allowed).toBe(true);
  });

  test("allows voice-related queries", async () => {
    expect((await assistantGuard("configure voice for my agent")).allowed).toBe(true);
  });

  test("allows cron-related queries", async () => {
    expect((await assistantGuard("add a cron schedule")).allowed).toBe(true);
    expect((await assistantGuard("set up a cron job")).allowed).toBe(true);
  });

  test("allows storage-related queries", async () => {
    expect((await assistantGuard("configure file storage")).allowed).toBe(true);
    expect((await assistantGuard("I need conversation storage")).allowed).toBe(true);
  });

  test("allows orchestrator-related queries", async () => {
    expect((await assistantGuard("set up an orchestrator")).allowed).toBe(true);
  });

  test("allows mcp-related queries", async () => {
    expect((await assistantGuard("expose my agents via mcp")).allowed).toBe(true);
  });

  test("allows job-related queries", async () => {
    expect((await assistantGuard("configure background job processing")).allowed).toBe(true);
  });

  test("allows memory-related queries", async () => {
    expect((await assistantGuard("add persistent memory")).allowed).toBe(true);
    expect((await assistantGuard("set up memory storage")).allowed).toBe(true);
  });

  test("allows command-related queries", async () => {
    expect((await assistantGuard("create a runtime command")).allowed).toBe(true);
  });

  test("allows hook-related queries", async () => {
    expect((await assistantGuard("configure lifecycle hook")).allowed).toBe(true);
  });

  test("allows guard-related queries", async () => {
    expect((await assistantGuard("add a guard to my agent")).allowed).toBe(true);
  });

  // --- Package/adapter keywords (the guardrail fix) ---

  test("allows package-related queries", async () => {
    expect((await assistantGuard("I need the core package")).allowed).toBe(true);
    expect((await assistantGuard("install the hono adapter")).allowed).toBe(true);
    expect((await assistantGuard("update core to latest")).allowed).toBe(true);
    expect((await assistantGuard("what version of hono do I have")).allowed).toBe(true);
  });

  test("allows adapter-related queries", async () => {
    expect((await assistantGuard("switch to elysia adapter")).allowed).toBe(true);
    expect((await assistantGuard("I want the hono-openapi adapter")).allowed).toBe(true);
  });

  test("allows scheduler-related queries", async () => {
    expect((await assistantGuard("add a scheduler")).allowed).toBe(true);
    expect((await assistantGuard("which scheduler should I use")).allowed).toBe(true);
  });

  test("allows webhook-related queries", async () => {
    expect((await assistantGuard("set up a webhook")).allowed).toBe(true);
  });

  // --- All action keywords with component keywords ---

  test("allows update queries", async () => {
    expect((await assistantGuard("update my weather tool")).allowed).toBe(true);
    expect((await assistantGuard("update the core package")).allowed).toBe(true);
  });

  test("allows remove/uninstall queries", async () => {
    expect((await assistantGuard("remove the weather agent")).allowed).toBe(true);
    expect((await assistantGuard("uninstall the echo tool")).allowed).toBe(true);
  });

  test("allows link/unlink queries", async () => {
    expect((await assistantGuard("link a tool to my agent")).allowed).toBe(true);
    expect((await assistantGuard("unlink the weather tool")).allowed).toBe(true);
  });

  test("allows scaffold/setup queries", async () => {
    expect((await assistantGuard("scaffold a new agent")).allowed).toBe(true);
    expect((await assistantGuard("set up a cron component")).allowed).toBe(true);
  });

  // --- Standalone keywords ---

  test("allows env/config queries", async () => {
    expect((await assistantGuard("configure environment variables")).allowed).toBe(true);
    expect((await assistantGuard("set up my api key")).allowed).toBe(true);
    expect((await assistantGuard("what's in my .env file")).allowed).toBe(true);
  });

  test("allows capabilities queries", async () => {
    expect((await assistantGuard("what are your capabilities")).allowed).toBe(true);
    expect((await assistantGuard("help")).allowed).toBe(true);
    expect((await assistantGuard("what can I do")).allowed).toBe(true);
  });

  test("allows registry queries", async () => {
    expect((await assistantGuard("show me the registry")).allowed).toBe(true);
    expect((await assistantGuard("what's available in the registry")).allowed).toBe(true);
  });

  // --- Rejection cases ---

  test("rejects off-topic queries", async () => {
    expect((await assistantGuard("write me a poem")).allowed).toBe(false);
    expect((await assistantGuard("explain quantum physics")).allowed).toBe(false);
    expect((await assistantGuard("what is the meaning of life")).allowed).toBe(false);
  });

  test("rejects generic build requests without component keywords", async () => {
    expect((await assistantGuard("build me a React app")).allowed).toBe(false);
    expect((await assistantGuard("create a landing page")).allowed).toBe(false);
    expect((await assistantGuard("build a todo app")).allowed).toBe(false);
  });

  test("rejects action-only keywords without component context", async () => {
    expect((await assistantGuard("install something")).allowed).toBe(false);
    expect((await assistantGuard("delete everything")).allowed).toBe(false);
  });

  // --- Case insensitivity ---

  test("handles case insensitivity", async () => {
    expect((await assistantGuard("ADD A WEATHER AGENT")).allowed).toBe(true);
    expect((await assistantGuard("What Can You Do")).allowed).toBe(true);
    expect((await assistantGuard("SET UP CRON")).allowed).toBe(true);
  });

  // --- Keyword arrays are complete ---

  test("COMPONENT_KEYWORDS includes all expected types", () => {
    const expected = [
      "agent", "tool", "skill", "storage", "component", "cron",
      "rule", "rules", "voice", "orchestrator", "mcp", "job", "memory",
      "command", "hook", "guard", "package", "adapter", "core", "hono",
      "scheduler", "webhook",
      "postgres", "redis", "mongo", "database", "sqlite", "supabase", "dynamodb",
      "monitor", "monitoring", "notification", "notify",
      "model", "provider", "openai", "anthropic", "groq", "openrouter",
    ];
    for (const kw of expected) {
      expect(COMPONENT_KEYWORDS).toContain(kw);
    }
  });

  test("ACTION_KEYWORDS includes all expected actions", () => {
    const expected = [
      "add", "create", "remove", "install", "uninstall", "link", "unlink",
      "scaffold", "setup", "set up", "build", "wire", "connect",
      "update", "configure", "generate", "delete",
    ];
    for (const kw of expected) {
      expect(ACTION_KEYWORDS).toContain(kw);
    }
  });

  test("STANDALONE_KEYWORDS includes all expected standalone terms", () => {
    const expected = [
      "available", "registry", "what can", "what do you have", "kitn",
      "capabilities", "help", "what can i do", "env", "environment",
      "api key", ".env",
      "installed", "what have", "show me", "list", "what's set up",
      "get started", "getting started", "how do i",
    ];
    for (const kw of expected) {
      expect(STANDALONE_KEYWORDS).toContain(kw);
    }
  });

  // --- Database/provider keywords (expanded guard) ---

  test("allows database-related queries", async () => {
    expect((await assistantGuard("set up a database")).allowed).toBe(true);
    expect((await assistantGuard("I want postgres storage")).allowed).toBe(true);
    expect((await assistantGuard("configure redis for memory")).allowed).toBe(true);
  });

  test("allows model/provider queries", async () => {
    expect((await assistantGuard("which model should I use")).allowed).toBe(true);
    expect((await assistantGuard("configure openai provider")).allowed).toBe(true);
    expect((await assistantGuard("switch to anthropic")).allowed).toBe(true);
    expect((await assistantGuard("use openrouter for my agent")).allowed).toBe(true);
  });

  test("allows monitoring queries", async () => {
    expect((await assistantGuard("set up monitoring")).allowed).toBe(true);
    expect((await assistantGuard("add a notification system")).allowed).toBe(true);
  });

  test("allows informational queries", async () => {
    expect((await assistantGuard("what's installed")).allowed).toBe(true);
    expect((await assistantGuard("show me my components")).allowed).toBe(true);
    expect((await assistantGuard("how do I get started")).allowed).toBe(true);
    expect((await assistantGuard("list all agents")).allowed).toBe(true);
  });
});
