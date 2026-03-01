import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { generateText, type LanguageModel } from "ai";
import { createPlanTool } from "../tools/create-plan.js";
import { buildSystemPrompt, type PromptContext } from "../prompts/system.js";

// ---------------------------------------------------------------------------
// Fast-path keyword check (avoids LLM call for obvious matches)
// ---------------------------------------------------------------------------

// Component-type keywords — the request must mention what kind of thing they want
export const COMPONENT_KEYWORDS = [
  "agent", "tool", "skill", "storage", "component", "cron",
  "rule", "rules", "voice", "orchestrator", "mcp", "job", "memory",
  "command", "hook", "guard", "package", "adapter", "core", "hono",
  "scheduler", "scheduling", "webhook",
  // API/endpoint patterns
  "api", "endpoint", "route", "server", "openapi",
  // Elysia adapter
  "elysia",
  // Database/storage backends (custom storage is a first-class use case)
  "postgres", "redis", "mongo", "database", "sqlite", "supabase", "dynamodb",
  // Monitoring/notification patterns
  "monitor", "monitoring", "notification", "notify",
  // Model/provider selection
  "model", "provider", "openai", "anthropic", "groq", "openrouter",
  // Conversation/chat (common data types for storage)
  "conversation", "chat",
  // Common synonyms users use for agents/crons
  "bot", "scheduled", "task",
];

// Action keywords — only pass the guard when combined with a component keyword
export const ACTION_KEYWORDS = [
  "add", "create", "remove", "install", "uninstall", "link", "unlink",
  "scaffold", "setup", "set up", "build", "wire", "connect",
  "update", "configure", "generate", "delete",
];

// Standalone keywords — these pass the guard on their own (informational queries)
export const STANDALONE_KEYWORDS = [
  "available", "registry", "what can", "what do you have", "kitn",
  "capabilities", "help", "what can i do", "env", "environment",
  "api key", "api_key", ".env",
  // Informational queries about project state
  "installed", "what have", "show me", "list", "what's set up",
  "get started", "getting started", "how do i",
];

// ---------------------------------------------------------------------------
// Guard result type
// ---------------------------------------------------------------------------

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  category?: GuardCategory;
}

// ---------------------------------------------------------------------------
// Keyword-based fast path (no LLM call needed)
// ---------------------------------------------------------------------------

export function keywordCheck(query: string): boolean {
  const lower = query.toLowerCase();

  if (STANDALONE_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (COMPONENT_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// LLM-based intent classifier
// ---------------------------------------------------------------------------

const CLASSIFIER_PROMPT = `You are a category classifier for "kitn", a TypeScript framework for building multi-agent AI systems.

kitn supports these categories:
- agent — creating, configuring, or managing AI agents (including bots, assistants, supervisors)
- tool — creating or managing tools that agents can use
- skill — prompt-based skills that extend agent capabilities
- storage — data storage, databases, conversation history, memory
- cron — scheduling, cron jobs, recurring tasks, timers
- voice — text-to-speech, speech-to-text, audio
- adapter — HTTP framework adapters (Hono, Elysia), API exposure, server setup, OpenAPI
- package — framework packages, core, MCP server
- model — AI model/provider selection (OpenAI, Anthropic, DeepSeek, Groq, etc.)
- config — environment variables, API keys, project setup, getting started
- info — questions about what's available, installed, capabilities, help
- off-topic — not related to building AI agent systems (poems, jokes, general knowledge, etc.)

Respond with EXACTLY one category name from the list above. When in doubt, pick the closest match — only use "off-topic" if the message clearly has nothing to do with building or configuring AI systems.`;

export type GuardCategory =
  | "agent" | "tool" | "skill" | "storage" | "cron" | "voice"
  | "adapter" | "package" | "model" | "config" | "info" | "off-topic";

const VALID_CATEGORIES = new Set<GuardCategory>([
  "agent", "tool", "skill", "storage", "cron", "voice",
  "adapter", "package", "model", "config", "info", "off-topic",
]);

export async function classifyWithLLM(
  query: string,
  model: LanguageModel,
): Promise<GuardCategory> {
  try {
    const result = await generateText({
      model,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: "user", content: query }],
      maxOutputTokens: 5,
    });

    const answer = (result.text ?? "").trim().toLowerCase() as GuardCategory;
    return VALID_CATEGORIES.has(answer) ? answer : "info";
  } catch {
    // If the classifier fails, allow the query through (fail-open)
    return "info";
  }
}

// ---------------------------------------------------------------------------
// Main guard (keyword fast-path + LLM fallback)
// ---------------------------------------------------------------------------

/** Model getter injected at startup. Null = keyword-only mode (for tests). */
let guardModel: LanguageModel | null = null;

export function setGuardModel(model: LanguageModel): void {
  guardModel = model;
}

export async function assistantGuard(query: string): Promise<GuardResult> {
  // Fast path: keywords match → allow immediately (no LLM cost)
  if (keywordCheck(query)) {
    return { allowed: true };
  }

  // LLM fallback: classify intent when keywords don't match
  if (guardModel) {
    const category = await classifyWithLLM(query, guardModel);
    if (category !== "off-topic") {
      return { allowed: true, category };
    }
    return {
      allowed: false,
      category: "off-topic",
      reason:
        "I can only help with setting up kitn components (agents, tools, skills, storage, crons, adapters, and more). Try something like 'I need an agent that summarizes articles' or 'What tools are available?'",
    };
  }

  // No model available (tests) — keyword-only mode rejects
  return {
    allowed: false,
    reason:
      "I can only help with setting up kitn components (agents, tools, skills, storage, crons, adapters, and more). Try something like 'I need an agent that summarizes articles' or 'What tools are available?'",
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
    guard: async (query: string) => assistantGuard(query),
  });
}
