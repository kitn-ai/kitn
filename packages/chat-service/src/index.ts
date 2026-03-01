import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createMemoryStorage } from "@kitnai/core";
import { createAIPlugin } from "@kitnai/hono-adapter";
import { registerAssistantAgent, assistantGuard, setGuardModel } from "./agents/assistant.js";
import { buildSystemPrompt } from "./prompts/system.js";
import { buildCompactionPrompt } from "./prompts/compact.js";
import type { PromptContext } from "./prompts/types.js";
import { createPlanTool } from "./tools/create-plan.js";
import { askUserTool, writeFileTool, readFileTool, listFilesTool, updateEnvTool } from "./tools/tools.js";

// --- Provider setup ---

const isOpenRouter = !!process.env.OPENROUTER_API_KEY;

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY,
  baseURL: isOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
});

const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gpt-4o-mini";
const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL ?? "openai/gpt-4o-mini";

// Use .chat() for OpenRouter (Responses API not supported) or default for OpenAI
const getModel = (id: string) =>
  isOpenRouter ? openai.chat(id) : openai(id);

// --- Plugin setup ---

const plugin = createAIPlugin({
  model: (id: string | undefined) => getModel(id ?? DEFAULT_MODEL),
  storage: createMemoryStorage(),
});

const defaultContext: PromptContext = { registryIndex: [], installed: [] };
registerAssistantAgent(plugin, defaultContext);

// Inject a fast/cheap model for the guard classifier (separate from the main model)
setGuardModel(getModel(CLASSIFIER_MODEL));

// --- Hono app ---

const app = new Hono();

app.use("/*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

// Custom /api/chat endpoint — registered BEFORE plugin router so it takes priority
app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const { messages, metadata, model: requestModel } = body;

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
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }

  // Build prompt context
  const promptContext: PromptContext = {
    registryIndex: metadata?.registryIndex ?? [],
    installed: metadata?.installed ?? [],
    globalRegistryIndex: metadata?.globalRegistryIndex,
  };

  const systemPrompt = buildSystemPrompt(promptContext);

  // Convert messages to Vercel AI SDK v6 format
  // v6 uses `input` (not `args`) in ToolCallPart, and `output` (not `result`) in ToolResultPart
  const aiMessages = messages.map((m: any) => {
    if (m.role === "tool" && m.toolResults) {
      return {
        role: "tool" as const,
        content: m.toolResults.map((r: any) => ({
          type: "tool-result" as const,
          toolCallId: r.toolCallId,
          toolName: r.toolName ?? "unknown",
          output: { type: "text" as const, value: typeof r.result === "string" ? r.result : JSON.stringify(r.result) },
        })),
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((tc: any) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input ?? {},
          })),
        ],
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
    const modelId = requestModel ?? DEFAULT_MODEL;
    const result = await generateText({
      model: getModel(modelId),
      system: systemPrompt,
      messages: aiMessages,
      tools,
    });

    // Extract tool calls from the result (SDK v6 uses `input` not `args`)
    const toolCalls = result.toolCalls?.map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.input ?? {},
    }));

    return c.json({
      message: {
        role: "assistant",
        content: result.text ?? "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    });
  } catch (err: any) {
    console.error("[/api/chat] Error:", err);
    return c.json({ error: err.message ?? "LLM call failed" }, 500);
  }
});

// Conversation compaction endpoint — summarises long conversations
app.post("/api/chat/compact", async (c) => {
  const { messages } = await c.req.json();

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "No messages to compact" }, 400);
  }

  const compactionPrompt = buildCompactionPrompt();

  const conversationText = messages
    .map((m: any) => `${m.role}: ${m.content ?? "[tool call/result]"}`)
    .join("\n");

  try {
    const result = await generateText({
      model: getModel(DEFAULT_MODEL),
      system: compactionPrompt,
      messages: [{ role: "user" as const, content: `Compact this conversation:\n\n${conversationText}` }],
    });

    return c.json({
      summary: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Compaction failed" }, 500);
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
