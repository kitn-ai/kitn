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

  test("rejects action keywords without component keywords", async () => {
    const result = await assistantGuard("Build me a React frontend");
    expect(result.allowed).toBe(false);
  });

  test("rejects generic build requests", async () => {
    const result = await assistantGuard("Create a REST API for my app");
    expect(result.allowed).toBe(false);
  });

  test("allows action + component keyword combo", async () => {
    const result = await assistantGuard("Build me an agent for customer support");
    expect(result.allowed).toBe(true);
  });

  test("allows standalone registry queries", async () => {
    const result = await assistantGuard("What do you have available?");
    expect(result.allowed).toBe(true);
  });

  test("rejects deploy/infrastructure requests", async () => {
    const result = await assistantGuard("Help me deploy my app to AWS");
    expect(result.allowed).toBe(false);
  });
});
