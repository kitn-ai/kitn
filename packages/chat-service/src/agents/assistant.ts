import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { createPlanTool } from "../tools/create-plan.js";
import { buildSystemPrompt, type PromptContext } from "../prompts/system.js";

// Keywords that indicate a kitn-related request
const ALLOWED_KEYWORDS = [
  "agent", "tool", "skill", "storage", "component", "cron",
  "add", "create", "remove", "install", "uninstall", "link", "unlink",
  "scaffold", "setup", "set up", "build", "wire", "connect",
  "available", "registry", "what can", "what do you have",
];

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export async function assistantGuard(query: string): Promise<GuardResult> {
  const lower = query.toLowerCase();
  const hasKeyword = ALLOWED_KEYWORDS.some((kw) => lower.includes(kw));

  if (hasKeyword) {
    return { allowed: true };
  }

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
