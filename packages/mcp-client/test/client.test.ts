import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { namespaceTool, buildToolRegistration } from "../src/client.js";

describe("namespaceTool", () => {
  test("creates namespaced tool name", () => {
    expect(namespaceTool("github", "createIssue")).toBe("github_createIssue");
  });

  test("handles single-word names", () => {
    expect(namespaceTool("server", "tool")).toBe("server_tool");
  });

  test("handles names with special characters", () => {
    expect(namespaceTool("my-server", "list_items")).toBe("my-server_list_items");
  });
});

describe("buildToolRegistration", () => {
  test("creates correct registration with description", () => {
    const mockTool = {
      description: "Create a GitHub issue",
      parameters: z.object({ title: z.string() }),
      execute: async (input: any) => ({ id: 1 }),
    };

    const reg = buildToolRegistration("github", "createIssue", mockTool);

    expect(reg.name).toBe("github_createIssue");
    expect(reg.description).toBe("[github] Create a GitHub issue");
    expect(reg.inputSchema).toBe(mockTool.parameters);
    expect(reg.tool).toBe(mockTool);
  });

  test("uses toolName as description fallback when description is missing", () => {
    const mockTool = {
      parameters: z.object({ query: z.string() }),
      execute: async (input: any) => [],
    };

    const reg = buildToolRegistration("search", "findItems", mockTool);

    expect(reg.name).toBe("search_findItems");
    expect(reg.description).toBe("[search] findItems");
  });

  test("uses toolName as description fallback when description is undefined", () => {
    const mockTool = {
      description: undefined,
      parameters: z.object({}),
      execute: async (input: any) => null,
    };

    const reg = buildToolRegistration("api", "ping", mockTool);

    expect(reg.description).toBe("[api] ping");
  });

  test("preserves the original tool object reference", () => {
    const mockTool = {
      description: "Test tool",
      parameters: z.object({}),
      execute: async () => "result",
    };

    const reg = buildToolRegistration("test", "myTool", mockTool);

    expect(reg.tool).toBe(mockTool);
  });
});
