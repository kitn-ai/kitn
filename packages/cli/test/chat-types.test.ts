import { describe, test, expect } from "bun:test";
import type {
  ChatMessage,
  ToolCall,
  ToolResult,
  ChatPlan,
  PlanStep,
  ChatServiceResponse,
  AskUserItem,
  UpdateEnvInput,
  WriteFileInput,
  ReadFileInput,
  ListFilesInput,
} from "../src/commands/chat-types.js";

describe("ChatMessage types", () => {
  test("user message shape is valid", () => {
    const msg: ChatMessage = {
      role: "user",
      content: "I want to build a weather agent",
    };
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("I want to build a weather agent");
  });

  test("assistant message with tool calls shape is valid", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me ask you some questions.",
      toolCalls: [
        {
          id: "call_1",
          name: "askUser",
          input: { items: [{ type: "option", text: "Pick an API", choices: ["A", "B"] }] },
        },
      ],
    };
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].name).toBe("askUser");
  });

  test("tool result message shape is valid", () => {
    const msg: ChatMessage = {
      role: "tool",
      toolResults: [
        { toolCallId: "call_1", toolName: "askUser", result: "User selected: A" },
      ],
    };
    expect(msg.role).toBe("tool");
    expect(msg.toolResults).toHaveLength(1);
  });

  test("PlanStep accepts update action", () => {
    const step: PlanStep = {
      action: "update",
      component: "weather-tool",
      reason: "Update to latest version",
    };
    expect(step.action).toBe("update");
  });

  test("ChatServiceResponse shape is valid", () => {
    const response: ChatServiceResponse = {
      message: {
        role: "assistant",
        content: "Here's what I'll do",
        toolCalls: [{ id: "1", name: "createPlan", input: {} }],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    expect(response.message.role).toBe("assistant");
    expect(response.usage.inputTokens).toBe(100);
  });

  test("AskUserItem shapes are valid", () => {
    const option: AskUserItem = {
      type: "option",
      text: "Pick one",
      choices: ["A", "B"],
      context: "We need this to proceed",
    };
    expect(option.type).toBe("option");
    expect(option.choices).toHaveLength(2);

    const info: AskUserItem = { type: "info", text: "Working on it..." };
    expect(info.type).toBe("info");
  });

  test("tool input types are valid", () => {
    const env: UpdateEnvInput = { key: "API_KEY", description: "Your API key" };
    expect(env.key).toBe("API_KEY");

    const write: WriteFileInput = { path: "src/test.ts", content: "hello", description: "Test file" };
    expect(write.path).toBe("src/test.ts");

    const read: ReadFileInput = { path: "src/test.ts" };
    expect(read.path).toBe("src/test.ts");

    const list: ListFilesInput = { pattern: "*.ts", directory: "src" };
    expect(list.pattern).toBe("*.ts");
  });
});
