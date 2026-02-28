import { describe, expect, test } from "bun:test";
import { createPlanTool } from "../src/tools/create-plan.js";

describe("createPlanTool", () => {
  test("has a description", () => {
    expect(createPlanTool.description).toBeTruthy();
    expect(typeof createPlanTool.description).toBe("string");
  });

  test("accepts a valid 'add' step and returns it", async () => {
    const plan = {
      summary: "Add the weather tool to the project",
      steps: [
        {
          action: "add" as const,
          component: "weather-tool",
          reason: "User wants weather functionality",
        },
      ],
    };

    const result = await createPlanTool.execute!(plan, {
      toolCallId: "test-1",
      messages: [],
    });

    expect(result).toEqual(plan);
  });

  test("accepts a valid 'create' step and returns it", async () => {
    const plan = {
      summary: "Create a custom Slack notification tool",
      steps: [
        {
          action: "create" as const,
          type: "tool",
          name: "slack-notify",
          description: "Send notifications to a Slack channel",
          reason: "User needs Slack integration not in the registry",
        },
      ],
    };

    const result = await createPlanTool.execute!(plan, {
      toolCallId: "test-2",
      messages: [],
    });

    expect(result).toEqual(plan);
  });

  test("accepts a valid 'link' step and returns it", async () => {
    const plan = {
      summary: "Link weather tool to general agent",
      steps: [
        {
          action: "link" as const,
          toolName: "weather-tool",
          agentName: "general-agent",
          reason: "Agent needs access to weather data",
        },
      ],
    };

    const result = await createPlanTool.execute!(plan, {
      toolCallId: "test-3",
      messages: [],
    });

    expect(result).toEqual(plan);
  });

  test("accepts a multi-step plan", async () => {
    const plan = {
      summary: "Set up a weather-aware assistant with custom Slack notifications",
      steps: [
        {
          action: "add" as const,
          component: "weather-tool",
          reason: "Need weather data fetching capability",
        },
        {
          action: "create" as const,
          type: "tool",
          name: "slack-notify",
          description: "Send messages to Slack channels via webhook",
          reason: "Custom Slack integration not in registry",
        },
        {
          action: "create" as const,
          type: "agent",
          name: "assistant-agent",
          description: "Main assistant that coordinates weather and notifications",
          reason: "Need an orchestrator agent",
        },
        {
          action: "link" as const,
          toolName: "weather-tool",
          agentName: "assistant-agent",
          reason: "Assistant needs weather data access",
        },
        {
          action: "link" as const,
          toolName: "slack-notify",
          agentName: "assistant-agent",
          reason: "Assistant needs to send Slack notifications",
        },
      ],
    };

    const result = await createPlanTool.execute!(plan, {
      toolCallId: "test-4",
      messages: [],
    });

    expect(result).toEqual(plan);
    expect(result.steps).toHaveLength(5);
  });
});
