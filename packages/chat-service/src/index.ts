import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createMemoryStorage } from "@kitnai/core";
import { createAIPlugin } from "@kitnai/hono-adapter";
import { registerAssistantAgent, assistantGuard } from "./agents/assistant.js";
import {
  buildSystemPrompt,
  type PromptContext,
  type RegistryItem,
} from "./prompts/system.js";
import { createPlanTool } from "./tools/create-plan.js";

// --- Provider setup ---

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_API_KEY
    ? "https://openrouter.ai/api/v1"
    : undefined,
});

const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gpt-4o-mini";

// --- Plugin setup ---

const plugin = createAIPlugin({
  model: (id) => openai(id ?? DEFAULT_MODEL),
  storage: createMemoryStorage(),
});

const defaultContext: PromptContext = { registryIndex: [], installed: [] };
registerAssistantAgent(plugin, defaultContext);

// --- Hono app ---

const app = new Hono();

app.use("/*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

// Custom /api/chat endpoint — registered BEFORE plugin router so it takes priority
app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const { message, metadata } = body as {
    message: string;
    metadata?: { registryIndex?: RegistryItem[]; installed?: string[] };
  };

  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  const guardResult = await assistantGuard(message);
  if (!guardResult.allowed) {
    return c.json({ rejected: true, message: guardResult.reason }, 200);
  }

  const promptContext: PromptContext = {
    registryIndex: metadata?.registryIndex ?? [],
    installed: metadata?.installed ?? [],
  };

  const systemPrompt = buildSystemPrompt(promptContext);

  const result = await generateText({
    model: openai(DEFAULT_MODEL),
    system: systemPrompt,
    prompt: message,
    tools: { createPlan: createPlanTool },
  });

  const planCall = result.steps
    .flatMap((s) => s.toolCalls)
    .find((tc) => tc.toolName === "createPlan");

  if (planCall) {
    return c.json({ plan: planCall.input });
  }

  return c.json({ text: result.text });
});

app.route("/api", plugin.router);

// --- Server ---

const port = Number(process.env.PORT) || 4002;

console.log(`[chat-service] Running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
