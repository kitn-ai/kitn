import { describe, test, expect } from "bun:test";
import { assistantGuard } from "../src/agents/assistant.js";

describe("assistantGuard", () => {
  // Existing cases should still pass
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

  // New vocabulary
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
    expect((await assistantGuard("set up a database")).allowed).toBe(false);
  });

  test("allows orchestrator-related queries", async () => {
    expect((await assistantGuard("set up an orchestrator")).allowed).toBe(true);
  });

  test("allows update queries", async () => {
    expect((await assistantGuard("update my weather tool")).allowed).toBe(true);
  });

  test("allows env/config queries", async () => {
    expect((await assistantGuard("configure environment variables")).allowed).toBe(true);
    expect((await assistantGuard("set up my api key")).allowed).toBe(true);
  });

  test("allows capabilities queries", async () => {
    expect((await assistantGuard("what are your capabilities")).allowed).toBe(true);
    expect((await assistantGuard("help")).allowed).toBe(true);
    expect((await assistantGuard("what can I do")).allowed).toBe(true);
  });

  test("rejects off-topic queries", async () => {
    expect((await assistantGuard("write me a poem")).allowed).toBe(false);
    expect((await assistantGuard("explain quantum physics")).allowed).toBe(false);
    expect((await assistantGuard("what is the meaning of life")).allowed).toBe(false);
  });
});
