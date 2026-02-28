import { describe, expect, test } from "bun:test";
import { assistantGuard } from "../src/agents/assistant.js";

describe("assistantGuard", () => {
  test("allows requests about adding agents", async () => {
    const result = await assistantGuard(
      "I want an agent that checks the weather"
    );
    expect(result.allowed).toBe(true);
  });

  test("allows requests about adding tools", async () => {
    const result = await assistantGuard(
      "Add a tool that sends Slack notifications"
    );
    expect(result.allowed).toBe(true);
  });

  test("allows requests about removing components", async () => {
    const result = await assistantGuard(
      "Remove the weather agent and its tools"
    );
    expect(result.allowed).toBe(true);
  });

  test("allows requests about what's available", async () => {
    const result = await assistantGuard("What agents are available?");
    expect(result.allowed).toBe(true);
  });

  test("allows requests about linking tools", async () => {
    const result = await assistantGuard(
      "Link the weather tool to my general agent"
    );
    expect(result.allowed).toBe(true);
  });

  test("rejects off-topic requests", async () => {
    const result = await assistantGuard("Write me a poem about cats");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
