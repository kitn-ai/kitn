import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AIPluginConfig, AIPluginInstance } from "./types.js";
import type { PluginContext } from "./context.js";
import { AgentRegistry } from "./registry/agent-registry.js";
import { ToolRegistry } from "./registry/tool-registry.js";
import { CardRegistry } from "./lib/card-registry.js";
import { DEFAULTS } from "./lib/constants.js";
import { setDefaultMemoryStore } from "./agents/memory-tool.js";
import { makeRegistryHandlers } from "./registry/handler-factories.js";
import { createOrchestratorAgent } from "./agents/orchestrator.js";
import { createMemoryStorage } from "./storage/in-memory/index.js";
import { VoiceManager } from "./voice/voice-manager.js";
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
    getModel: config.getModel,
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
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.notFound((c) => {
    return c.json({ error: "Not Found" }, 404);
  });

  // Health check (no auth)
  app.route("/health", createHealthRoutes(ctx));

  // Apply auth middleware if provided
  if (config.authMiddleware) {
    app.use("/*", config.authMiddleware);
  }

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
