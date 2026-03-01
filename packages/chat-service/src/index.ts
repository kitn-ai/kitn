import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createMemoryStorage } from "@kitnai/core";
import { createAIPlugin } from "@kitnai/hono-adapter";
import { registerAssistantAgent, assistantGuard } from "./agents/assistant.js";
import { buildSystemPrompt } from "./prompts/system.js";
import type { PromptContext } from "./prompts/types.js";
import { createPlanTool } from "./tools/create-plan.js";
import { askUserTool, writeFileTool, readFileTool, listFilesTool, updateEnvTool } from "./tools/tools.js";

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
  const { messages, metadata } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ rejected: true, text: "No messages provided." }, 400);
  }

  // Extract latest user message for guard check
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
  if (!lastUserMsg?.content) {
    return c.json({ rejected: true, text: "No user message found." }, 400);
  }

  // Guard check
  const guardResult = await assistantGuard(lastUserMsg.content);
  if (!guardResult.allowed) {
    return c.json({
      rejected: true,
      text: guardResult.reason,
      message: { role: "assistant", content: guardResult.reason ?? "Request not allowed." },
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  }

  // Build prompt context
  const promptContext: PromptContext = {
    registryIndex: metadata?.registryIndex ?? [],
    installed: metadata?.installed ?? [],
    globalRegistryIndex: metadata?.globalRegistryIndex,
  };

  const systemPrompt = buildSystemPrompt(promptContext);

  // Convert messages to Vercel AI SDK format
  const aiMessages = messages.map((m: any) => {
    if (m.role === "tool" && m.toolResults) {
      return {
        role: "tool" as const,
        content: m.toolResults.map((r: any) => ({
          type: "tool-result" as const,
          toolCallId: r.toolCallId,
          result: r.result,
        })),
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content ?? "" };
  });

  // All available tools
  const tools = {
    askUser: askUserTool,
    createPlan: createPlanTool,
    writeFile: writeFileTool,
    readFile: readFileTool,
    listFiles: listFilesTool,
    updateEnv: updateEnvTool,
  };

  try {
    const result = await generateText({
      model: openai(DEFAULT_MODEL),
      system: systemPrompt,
      messages: aiMessages,
      tools,
      maxSteps: 1,
    });

    // Extract tool calls from the result
    const toolCalls = result.toolCalls?.map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.args,
    }));

    return c.json({
      message: {
        role: "assistant",
        content: result.text ?? "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "LLM call failed" }, 500);
  }
});

app.route("/api", plugin.router);

// --- Server ---

const port = Number(process.env.PORT) || 4002;

console.log(`[chat-service] Running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
