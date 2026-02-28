import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { createPlanTool } from "../tools/create-plan.js";
import { buildSystemPrompt, type PromptContext } from "../prompts/system.js";

// Component-type keywords — the request must mention what kind of thing they want
const COMPONENT_KEYWORDS = [
  "agent", "tool", "skill", "storage", "component", "cron",
];

// Action keywords — only pass the guard when combined with a component keyword
const ACTION_KEYWORDS = [
  "add", "create", "remove", "install", "uninstall", "link", "unlink",
  "scaffold", "setup", "set up", "build", "wire", "connect",
];

// Standalone keywords — these pass the guard on their own (informational queries)
const STANDALONE_KEYWORDS = [
  "available", "registry", "what can", "what do you have", "kitn",
];

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export async function assistantGuard(query: string): Promise<GuardResult> {
  const lower = query.toLowerCase();

  // Standalone keywords always pass (e.g. "what's available?", "kitn components")
  if (STANDALONE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { allowed: true };
  }

  // Component keywords always pass (e.g. "I want an agent", "add a tool")
  if (COMPONENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { allowed: true };
  }

  // Action keywords alone are too broad ("build me a React app" should be rejected)
  // They only pass when combined with a component keyword (already handled above)

  return {
    allowed: false,
    reason:
      "I can only help with setting up kitn components (agents, tools, skills, storage). Try something like 'I need an agent that summarizes articles' or 'What tools are available?'",
  };
}

export function registerAssistantAgent(plugin: AIPluginInstance, promptContext: PromptContext) {
  const tools = { createPlan: createPlanTool };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

  const systemPrompt = buildSystemPrompt(promptContext);

  plugin.agents.register({
    name: "assistant",
    description: "AI-powered scaffolding assistant that plans kitn CLI actions",
    toolNames: ["createPlan"],
    defaultFormat: "json",
    defaultSystem: systemPrompt,
    tools,
    sseHandler,
    jsonHandler,
    guard: async (query) => assistantGuard(query),
  });
}
