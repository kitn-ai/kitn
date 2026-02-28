import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AIPluginConfig, AIPluginInstance } from "./types.js";
import type { PluginContext, KitnPlugin } from "@kitnai/core";
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
  createLifecycleHooks,
  createEventBuffer,
} from "@kitnai/core";
import { configureOpenAPI } from "./lib/configure-openapi.js";

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
import { createJobRoutes } from "./routes/jobs/jobs.routes.js";

function mountPlugin(app: OpenAPIHono, plugin: KitnPlugin, ctx: PluginContext) {
  const sub = new OpenAPIHono();
  for (const route of plugin.routes) {
    if (route.schema) {
      // Cast to satisfy @hono/zod-openapi's stricter RouteConfig types —
      // PluginRouteSchema uses generic z.ZodType while createRoute expects
      // narrower types (ZodObject for params/query, ZodRequestBody for body).
      const openApiRoute = createRoute({
        method: route.method.toLowerCase() as any,
        path: route.path,
        summary: route.schema.summary,
        description: route.schema.description,
        tags: route.schema.tags,
        ...(route.schema.request && { request: route.schema.request as any }),
        responses: route.schema.responses ?? {
          200: { description: "Success" },
        },
      });
      sub.openapi(openApiRoute, (async (c: any) => {
        return route.handler({
          request: c.req.raw,
          params: c.req.param(),
          pluginContext: ctx,
        });
      }) as any);
    } else {
      const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
      sub[method](route.path, async (c) => {
        return route.handler({
          request: c.req.raw,
          params: c.req.param(),
          pluginContext: ctx,
        });
      });
    }
  }
  app.route(plugin.prefix, sub);
}

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

  const hooks = config.hooks
    ? createLifecycleHooks(config.hooks)
    : undefined;

  const eventBuffer = createEventBuffer();

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
    hooks,
    eventBuffer,
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
  app.route("/jobs", createJobRoutes(ctx));
  // Conditionally mount cron routes
  if (cronScheduler) {
    app.route("/crons", createCronRoutes(ctx));
  }

  // Conditionally mount voice routes
  if (voice) {
    app.route("/voice", createVoiceRoutes(ctx));
  }

  // Configure OpenAPI docs
  configureOpenAPI(app, config.openapi);

  // Mount plugins
  for (const plugin of config.plugins ?? []) {
    mountPlugin(app, plugin, ctx);
  }

  // Run plugin init functions (fire-and-forget)
  const initPromise = Promise.all(
    (config.plugins ?? [])
      .filter((p) => p.init)
      .map((p) => Promise.resolve(p.init!(ctx)).catch((err) =>
        console.error(`[kitn] Plugin "${p.name}" init failed:`, err)
      ))
  );
  if (config.waitUntil) {
    config.waitUntil(initPromise);
  } else {
    initPromise.catch(() => {});
  }

  // Plugin discovery endpoint
  app.get("/plugins", (c) => {
    const plugins = (config.plugins ?? []).map((p) => ({
      name: p.name,
      prefix: p.prefix,
      routes: p.routes.map((r) => ({
        method: r.method,
        path: `${p.prefix}${r.path}`,
        summary: r.schema?.summary,
      })),
    }));
    return c.json({ plugins });
  });

  return {
    ...ctx,
    eventBuffer,
    router: app,
    createHandlers(handlerConfig) {
      return makeRegistryHandlers(handlerConfig, ctx);
    },
    createOrchestrator(orchestratorConfig) {
      return createOrchestratorAgent(ctx, orchestratorConfig);
    },
    on(event: any, handler: any) {
      if (!ctx.hooks) throw new Error("Hooks not configured. Set `hooks` in plugin config.");
      return ctx.hooks.on(event, handler);
    },
  };
}
