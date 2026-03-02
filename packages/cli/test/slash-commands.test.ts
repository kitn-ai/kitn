import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { isSlashCommand, handleSlashCommand, SLASH_COMMAND_DEFS } from "../src/commands/chat/slash-commands.js";
import { createConversation, appendMessage } from "../src/commands/chat/storage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kitn-slash-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("isSlashCommand", () => {
  test("returns true for slash-prefixed input", () => {
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/resume")).toBe(true);
    expect(isSlashCommand("/compact")).toBe(true);
    expect(isSlashCommand("/export")).toBe(true);
    expect(isSlashCommand("/history")).toBe(true);
    expect(isSlashCommand("/clear")).toBe(true);
  });

  test("returns false for regular input", () => {
    expect(isSlashCommand("hello")).toBe(false);
    expect(isSlashCommand("add a weather agent")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
  });

  test("returns true for unknown slash commands", () => {
    expect(isSlashCommand("/unknown")).toBe(true);
    expect(isSlashCommand("/foo")).toBe(true);
  });
});

describe("handleSlashCommand", () => {
  function makeCtx(overrides?: Partial<{
    cwd: string;
    conversationId: string;
    compactNow: () => Promise<void>;
    clearMessages: () => void;
  }>) {
    return {
      cwd: tmpDir,
      conversationId: "conv_test_0000",
      compactNow: async () => {},
      clearMessages: () => {},
      ...overrides,
    };
  }

  describe("/help", () => {
    test("returns message with command list", async () => {
      const result = await handleSlashCommand("/help", makeCtx());
      expect(result.type).toBe("message");
      if (result.type === "message") {
        expect(result.content).toContain("/resume");
        expect(result.content).toContain("/compact");
        expect(result.content).toContain("/export");
        expect(result.content).toContain("/history");
        expect(result.content).toContain("/clear");
      }
    });

    test("is case-insensitive", async () => {
      const result = await handleSlashCommand("/HELP", makeCtx());
      expect(result.type).toBe("message");
    });

    test("shows both session and CLI sections", async () => {
      const result = await handleSlashCommand("/help", makeCtx());
      if (result.type === "message") {
        expect(result.content).toContain("Session commands:");
        expect(result.content).toContain("CLI commands:");
        expect(result.content).toContain("/init");
        expect(result.content).toContain("/add");
        expect(result.content).toContain("/list");
        expect(result.content).toContain("/link");
        expect(result.content).toContain("/diff");
      }
    });
  });

  describe("/resume", () => {
    test("returns interactive result", async () => {
      const result = await handleSlashCommand("/resume", makeCtx());
      expect(result.type).toBe("interactive");
      if (result.type === "interactive") {
        expect(result.command).toBe("resume");
      }
    });
  });

  describe("/compact", () => {
    test("calls compactNow callback", async () => {
      let called = false;
      const ctx = makeCtx({
        compactNow: async () => { called = true; },
      });

      const result = await handleSlashCommand("/compact", ctx);
      expect(called).toBe(true);
      expect(result.type).toBe("message");
    });
  });

  describe("/export", () => {
    test("exports conversation and returns path", async () => {
      // Create a conversation with messages to export
      const conv = await createConversation(tmpDir, "Export test");
      await appendMessage(tmpDir, conv.id, { role: "user", content: "Hello" });
      await appendMessage(tmpDir, conv.id, { role: "assistant", content: "Hi" });

      const ctx = makeCtx({ conversationId: conv.id });
      const result = await handleSlashCommand("/export", ctx);
      expect(result.type).toBe("message");
      if (result.type === "message") {
        expect(result.content).toContain("Exported to");
        expect(result.content).toContain(".kitn/exports/");
      }
    });

    test("handles export failure gracefully", async () => {
      // Non-existent conversation — exportConversation will create an empty file
      // but this should still succeed (no meta event, but no error thrown)
      const ctx = makeCtx({ conversationId: "conv_nonexistent_0000" });
      const result = await handleSlashCommand("/export", ctx);
      expect(result.type).toBe("message");
    });
  });

  describe("/history", () => {
    test("shows no history when empty", async () => {
      const result = await handleSlashCommand("/history", makeCtx());
      expect(result.type).toBe("message");
      if (result.type === "message") {
        expect(result.content).toContain("No conversation history");
      }
    });

    test("shows conversation list", async () => {
      await createConversation(tmpDir, "First conversation");
      await createConversation(tmpDir, "Second conversation");

      const result = await handleSlashCommand("/history", makeCtx());
      expect(result.type).toBe("message");
      if (result.type === "message") {
        expect(result.content).toContain("First conversation");
        expect(result.content).toContain("Second conversation");
        expect(result.content).toContain("Recent conversations:");
      }
    });

    test("limits to 10 conversations", async () => {
      for (let i = 0; i < 15; i++) {
        await createConversation(tmpDir, `Conversation ${i}`);
      }

      const result = await handleSlashCommand("/history", makeCtx());
      if (result.type === "message") {
        // Count the number of conv_ IDs in the output
        const matches = result.content.match(/conv_/g);
        expect(matches?.length ?? 0).toBeLessThanOrEqual(10);
      }
    });
  });

  describe("/clear", () => {
    test("calls clearMessages callback", async () => {
      let cleared = false;
      const ctx = makeCtx({
        clearMessages: () => { cleared = true; },
      });

      const result = await handleSlashCommand("/clear", ctx);
      expect(cleared).toBe(true);
      expect(result.type).toBe("message");
      if (result.type === "message") {
        expect(result.content).toContain("cleared");
      }
    });
  });

  describe("unknown commands", () => {
    test("returns noop for unknown command", async () => {
      const result = await handleSlashCommand("/unknown", makeCtx());
      expect(result.type).toBe("noop");
    });

    test("returns noop for /foo", async () => {
      const result = await handleSlashCommand("/foo", makeCtx());
      expect(result.type).toBe("noop");
    });
  });

  describe("command parsing", () => {
    test("ignores trailing text after command", async () => {
      const result = await handleSlashCommand("/help extra text", makeCtx());
      expect(result.type).toBe("message");
    });

    test("handles leading whitespace in command name", async () => {
      // The command text starts with /, no leading whitespace expected
      // but trailing whitespace should be handled
      const result = await handleSlashCommand("/help   ", makeCtx());
      expect(result.type).toBe("message");
    });
  });

  describe("CLI commands", () => {
    describe("/init", () => {
      test("returns cli result with --yes flag", async () => {
        const result = await handleSlashCommand("/init", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["init", "--yes"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("passes extra args through", async () => {
        const result = await handleSlashCommand("/init --force", makeCtx());
        if (result.type === "cli") {
          expect(result.args).toEqual(["init", "--yes", "--force"]);
        }
      });
    });

    describe("/add", () => {
      test("returns cli result with --yes --overwrite", async () => {
        const result = await handleSlashCommand("/add weather-agent", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["add", "weather-agent", "--yes", "--overwrite"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("supports multiple components", async () => {
        const result = await handleSlashCommand("/add weather-agent echo-tool", makeCtx());
        if (result.type === "cli") {
          expect(result.args).toEqual(["add", "weather-agent", "echo-tool", "--yes", "--overwrite"]);
        }
      });

      test("shows usage hint when no args", async () => {
        const result = await handleSlashCommand("/add", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
          expect(result.content).toContain("/add");
        }
      });
    });

    describe("/remove", () => {
      test("returns cli result", async () => {
        const result = await handleSlashCommand("/remove weather-agent", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["remove", "weather-agent"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("shows usage hint when no args", async () => {
        const result = await handleSlashCommand("/remove", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });
    });

    describe("/list", () => {
      test("returns cli result", async () => {
        const result = await handleSlashCommand("/list", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["list"]);
          expect(result.mutating).toBe(false);
        }
      });

      test("passes optional type filter", async () => {
        const result = await handleSlashCommand("/list agent", makeCtx());
        if (result.type === "cli") {
          expect(result.args).toEqual(["list", "agent"]);
        }
      });
    });

    describe("/info", () => {
      test("returns cli result", async () => {
        const result = await handleSlashCommand("/info weather-agent", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["info", "weather-agent"]);
          expect(result.mutating).toBe(false);
        }
      });

      test("shows usage hint when no args", async () => {
        const result = await handleSlashCommand("/info", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });
    });

    describe("/update", () => {
      test("returns cli result with no args", async () => {
        const result = await handleSlashCommand("/update", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["update"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("passes component names", async () => {
        const result = await handleSlashCommand("/update weather-agent", makeCtx());
        if (result.type === "cli") {
          expect(result.args).toEqual(["update", "weather-agent"]);
        }
      });
    });

    describe("/link", () => {
      test("returns cli result with correct arg mapping", async () => {
        const result = await handleSlashCommand("/link echo general", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["link", "tool", "echo", "--to", "general"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("shows usage hint with 0 args", async () => {
        const result = await handleSlashCommand("/link", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });

      test("shows usage hint with 1 arg", async () => {
        const result = await handleSlashCommand("/link echo", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });
    });

    describe("/unlink", () => {
      test("returns cli result with correct arg mapping", async () => {
        const result = await handleSlashCommand("/unlink echo general", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["unlink", "tool", "echo", "--from", "general"]);
          expect(result.mutating).toBe(true);
        }
      });

      test("shows usage hint with insufficient args", async () => {
        const result = await handleSlashCommand("/unlink", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });
    });

    describe("/diff", () => {
      test("returns cli result", async () => {
        const result = await handleSlashCommand("/diff weather-agent", makeCtx());
        expect(result.type).toBe("cli");
        if (result.type === "cli") {
          expect(result.args).toEqual(["diff", "weather-agent"]);
          expect(result.mutating).toBe(false);
        }
      });

      test("shows usage hint when no args", async () => {
        const result = await handleSlashCommand("/diff", makeCtx());
        expect(result.type).toBe("message");
        if (result.type === "message") {
          expect(result.content).toContain("Usage:");
        }
      });
    });

    describe("mutating flag", () => {
      test("mutating commands: init, add, remove, link, unlink, update", async () => {
        const mutating = [
          ["/init", true],
          ["/add x", true],
          ["/remove x", true],
          ["/link a b", true],
          ["/unlink a b", true],
          ["/update", true],
        ] as const;

        for (const [cmd, expected] of mutating) {
          const result = await handleSlashCommand(cmd, makeCtx());
          if (result.type === "cli") {
            expect(result.mutating).toBe(expected);
          }
        }
      });

      test("non-mutating commands: list, info, diff", async () => {
        const nonMutating = [
          "/list",
          "/info x",
          "/diff x",
        ];

        for (const cmd of nonMutating) {
          const result = await handleSlashCommand(cmd, makeCtx());
          if (result.type === "cli") {
            expect(result.mutating).toBe(false);
          }
        }
      });
    });
  });
});

describe("SLASH_COMMAND_DEFS", () => {
  test("exports all session and CLI commands", () => {
    const names = SLASH_COMMAND_DEFS.map((d) => d.name);
    expect(names).toContain("/resume");
    expect(names).toContain("/init");
    expect(names).toContain("/add");
    expect(names).toContain("/diff");
  });

  test("session commands come before CLI commands", () => {
    const sections = SLASH_COMMAND_DEFS.map((d) => d.section);
    const lastSession = sections.lastIndexOf("session");
    const firstCli = sections.indexOf("cli");
    expect(lastSession).toBeLessThan(firstCli);
  });

  test("each entry has name, description, and section", () => {
    for (const def of SLASH_COMMAND_DEFS) {
      expect(def.name).toMatch(/^\//);
      expect(def.description.length).toBeGreaterThan(0);
      expect(["session", "cli"]).toContain(def.section);
    }
  });
});
