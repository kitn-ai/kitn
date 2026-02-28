import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AIPluginConfig, AIPluginInstance } from "./types.js";
import type { PluginContext } from "@kitnai/core";
import {
  AgentRegistry,
  ToolRegistry,
  CardRegistry,
  DEFAULTS,
  setDefaultMemoryStore,
  makeRegistryHandlers,
  createOrchestratorAgent,
  createMemoryStorage,
  VoiceManager,
} from "@kitnai/core";

// Route factories
import { createAgentsRoutes } from "./routes/agents/agents.routes.js";
import { createToolsRoutes } from "./routes/tools/tools.routes.js";
import { createGenerateRoutes } from "./routes/generate/generate.routes.js";
import { createMemoryRoutes } from "./routes/memory/memory.routes.js";
import { createSkillsRoutes } from "./routes/skills/skills.routes.js";
import { createConversationsRoutes } from "./routes/conversations/conversations.routes.js";
import { createVoiceRoutes } from "./routes/voice/voice.routes.js";
import { createCommandsRoutes } from "./routes/commands/commands.routes.js";
import { createCronRoutes } from "./routes/crons/crons.routes.js";

export function createAIPlugin(config: AIPluginConfig): AIPluginInstance {
  if (config.memoryStore) {
    setDefaultMemoryStore(config.memoryStore);
  }

  const storage = config.storage ?? (() => {
    console.log("[ai] Using in-memory storage (data will not persist across restarts)");
    return createMemoryStorage();
  })();

  const agents = new AgentRegistry();
  agents.setPromptStore(storage.prompts);
  const tools = new ToolRegistry();
  const cards = new CardRegistry();
  const voice = config.voice ? new VoiceManager() : undefined;

  const cronScheduler = config.cronScheduler;

  const ctx: PluginContext = {
    agents,
    tools,
    storage,
    model: config.model ?? (() => {
      throw new Error(
        "No AI model configured. Set the model option in your plugin config.\n" +
        "See: https://sdk.vercel.ai/providers/ai-sdk-providers",
      );
    }),
    voice,
    cards,
    cronScheduler,
    maxDelegationDepth: config.maxDelegationDepth ?? DEFAULTS.MAX_DELEGATION_DEPTH,
    defaultMaxSteps: config.defaultMaxSteps ?? DEFAULTS.MAX_STEPS,
    config,
  };

  // Build the Hono sub-app
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }

    // Surface AI SDK errors (auth failures, rate limits, bad requests, etc.)
    if (err.name?.startsWith("AI_")) {
      const aiErr = err as any;
      const status = aiErr.statusCode ?? 500;
      const upstream = aiErr.responseBody
        ? (() => { try { return JSON.parse(aiErr.responseBody); } catch { return undefined; } })()
        : undefined;
      const code = status >= 400 && status < 500 ? status : 502;
      console.error(`[ai] AI provider error (${status}):`, err.message);
      return c.json({
        error: err.message,
        ...(aiErr.url && { url: aiErr.url }),
        ...(upstream && { upstream }),
      }, code as any);
    }

    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  // Mount API routes
  app.route("/generate", createGenerateRoutes(ctx));
  app.route("/tools", createToolsRoutes(ctx));
  app.route("/agents", createAgentsRoutes(ctx));
  app.route("/memory", createMemoryRoutes(ctx));
  app.route("/skills", createSkillsRoutes(ctx));
  app.route("/conversations", createConversationsRoutes(ctx));
  app.route("/commands", createCommandsRoutes(ctx));
  // Conditionally mount cron routes
  if (cronScheduler) {
    app.route("/crons", createCronRoutes(ctx));
  }

  // Conditionally mount voice routes
  if (voice) {
    app.route("/voice", createVoiceRoutes(ctx));
  }

  return {
    ...ctx,
    router: app,
    createHandlers(handlerConfig) {
      return makeRegistryHandlers(handlerConfig, ctx);
    },
    createOrchestrator(orchestratorConfig) {
      return createOrchestratorAgent(ctx, orchestratorConfig);
    },
  };
}
