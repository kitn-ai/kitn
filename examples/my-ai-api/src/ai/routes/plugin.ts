import { OpenAPIHono } from "@hono/zod-openapi";
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
import { configureOpenAPI } from "./lib/configure-openapi.js";

// Route factories
import { createHealthRoutes } from "./routes/health/health.route.js";
import { createAgentsRoutes } from "./routes/agents/agents.routes.js";
import { createToolsRoutes } from "./routes/tools/tools.routes.js";
import { createGenerateRoutes } from "./routes/generate/generate.routes.js";
import { createMemoryRoutes } from "./routes/memory/memory.routes.js";
import { createSkillsRoutes } from "./routes/skills/skills.routes.js";
import { createConversationsRoutes } from "./routes/conversations/conversations.routes.js";
import { createVoiceRoutes } from "./routes/voice/voice.routes.js";

export function createAIPlugin(config: AIPluginConfig): AIPluginInstance {
  if (config.memoryStore) {
    setDefaultMemoryStore(config.memoryStore);
  }

  const storage = config.storage ?? (() => {
    console.log("[ai-plugin] Using in-memory storage (data will not persist across restarts)");
    return createMemoryStorage();
  })();

  const agents = new AgentRegistry();
  const tools = new ToolRegistry();
  const cards = new CardRegistry();
  const voice = config.voice ? new VoiceManager() : undefined;

  const ctx: PluginContext = {
    agents,
    tools,
    storage,
    model: config.model,
    voice,
    cards,
    maxDelegationDepth: config.maxDelegationDepth ?? DEFAULTS.MAX_DELEGATION_DEPTH,
    defaultMaxSteps: config.defaultMaxSteps ?? DEFAULTS.MAX_STEPS,
    config,
  };

  // Build the Hono sub-app
  const app = new OpenAPIHono();

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
      console.error(`[ai-plugin] AI provider error (${status}):`, err.message);
      return c.json({
        error: err.message,
        ...(aiErr.url && { url: aiErr.url }),
        ...(upstream && { upstream }),
      }, code as any);
    }

    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.notFound((c) => {
    return c.json({ error: "Not Found" }, 404);
  });

  // Health check
  app.route("/health", createHealthRoutes(ctx));

  // Mount API routes
  app.route("/generate", createGenerateRoutes(ctx));
  app.route("/tools", createToolsRoutes(ctx));
  app.route("/agents", createAgentsRoutes(ctx));
  app.route("/memory", createMemoryRoutes(ctx));
  app.route("/skills", createSkillsRoutes(ctx));
  app.route("/conversations", createConversationsRoutes(ctx));

  // Conditionally mount voice routes
  if (voice) {
    app.route("/voice", createVoiceRoutes(ctx));
  }

  // Configure OpenAPI docs
  configureOpenAPI(app, config.openapi);

  return {
    app,
    agents,
    tools,
    cards,
    voice,
    async initialize() {
      // Load persisted prompt overrides
      const overrides = await storage.prompts.loadOverrides();
      const overrideMap: Record<string, string> = {};
      for (const [name, entry] of Object.entries(overrides)) {
        overrideMap[name] = entry.prompt;
      }
      agents.loadPromptOverrides(overrideMap);

      const skills = await storage.skills.listSkills();
      console.log(
        `[ai-plugin] Initialized: ${agents.list().length} agents, ${tools.list().length} tools, ${skills.length} skills`,
      );
    },
    createHandlers(handlerConfig) {
      return makeRegistryHandlers(handlerConfig, ctx);
    },
    createOrchestrator(orchestratorConfig) {
      return createOrchestratorAgent(ctx, orchestratorConfig);
    },
  };
}
