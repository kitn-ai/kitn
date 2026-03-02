import { describe, test, expect } from "bun:test";
import { filterCommands } from "../src/commands/chat/components/slash-dropdown.js";

const COMMANDS = [
  { name: "/resume", description: "Resume a conversation", section: "session" as const },
  { name: "/clear", description: "Clear conversation", section: "session" as const },
  { name: "/add", description: "Add components", section: "cli" as const },
  { name: "/remove", description: "Remove a component", section: "cli" as const },
  { name: "/list", description: "List components", section: "cli" as const },
  { name: "/link", description: "Link tool to agent", section: "cli" as const },
  { name: "/init", description: "Initialize kitn", section: "cli" as const },
  { name: "/info", description: "Show component details", section: "cli" as const },
  { name: "/update", description: "Update components", section: "cli" as const },
  { name: "/unlink", description: "Unlink tool", section: "cli" as const },
  { name: "/diff", description: "Show diff", section: "cli" as const },
];

describe("filterCommands", () => {
  test("returns all commands for empty filter", () => {
    const result = filterCommands(COMMANDS, "");
    expect(result.length).toBe(8);
  });

  test("filters by prefix after /", () => {
    const result = filterCommands(COMMANDS, "add");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("/add");
  });

  test("filters case-insensitively", () => {
    const result = filterCommands(COMMANDS, "ADD");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("/add");
  });

  test("matches partial prefix", () => {
    const result = filterCommands(COMMANDS, "li");
    expect(result.map((r) => r.name)).toEqual(["/list", "/link"]);
  });

  test("limits to 8 results", () => {
    const result = filterCommands(COMMANDS, "");
    expect(result.length).toBeLessThanOrEqual(8);
  });

  test("session commands appear before CLI commands", () => {
    const result = filterCommands(COMMANDS, "");
    const sections = result.map((r) => r.section);
    const lastSession = sections.lastIndexOf("session");
    const firstCli = sections.indexOf("cli");
    if (lastSession >= 0 && firstCli >= 0) {
      expect(lastSession).toBeLessThan(firstCli);
    }
  });
});
