import { Elysia } from "elysia";
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
import { createAgentsRoutes } from "./routes/agents.js";
import { createToolsRoutes } from "./routes/tools.js";
import { createGenerateRoutes } from "./routes/generate.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { createConversationsRoutes } from "./routes/conversations.js";
import { createVoiceRoutes } from "./routes/voice.js";
import { createCommandsRoutes } from "./routes/commands.js";

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
    maxDelegationDepth: config.maxDelegationDepth ?? DEFAULTS.MAX_DELEGATION_DEPTH,
    defaultMaxSteps: config.defaultMaxSteps ?? DEFAULTS.MAX_STEPS,
    config,
  };

  // Build the Elysia sub-app
  const app = new Elysia();

  app.onError(({ error, set }) => {
    // Let non-Error values (e.g. ElysiaCustomStatusResponse) pass through
    if (!(error instanceof Error)) return;

    // Surface AI SDK errors (auth failures, rate limits, bad requests, etc.)
    if (error.name?.startsWith("AI_")) {
      const aiErr = error as any;
      const statusCode = aiErr.statusCode ?? 500;
      const upstream = aiErr.responseBody
        ? (() => { try { return JSON.parse(aiErr.responseBody); } catch { return undefined; } })()
        : undefined;
      const code = statusCode >= 400 && statusCode < 500 ? statusCode : 502;
      console.error(`[ai] AI provider error (${statusCode}):`, error.message);
      set.status = code;
      return {
        error: error.message,
        ...(aiErr.url && { url: aiErr.url }),
        ...(upstream && { upstream }),
      };
    }

    console.error(error);
    set.status = 500;
    return { error: "Internal Server Error" };
  });

  // Mount API routes
  app.use(createGenerateRoutes(ctx));
  app.use(createToolsRoutes(ctx));
  app.use(createAgentsRoutes(ctx));
  app.use(createMemoryRoutes(ctx));
  app.use(createSkillsRoutes(ctx));
  app.use(createConversationsRoutes(ctx));
  app.use(createCommandsRoutes(ctx));

  // Conditionally mount voice routes
  if (voice) {
    app.use(createVoiceRoutes(ctx));
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
