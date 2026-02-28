import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAIPlugin, createFileStorage, createInternalScheduler, OpenAIVoiceProvider } from "@kitnai/hono-adapter";
import { createMCPServer } from "@kitnai/mcp-server-adapter";
import { connectMCPServers } from "@kitnai/mcp-client";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { env, printConfig, voiceEnabled } from "./env.js";
import { registerEchoTool } from "./tools/echo.js";
import { registerWeatherTool } from "./tools/weather.js";
import { registerCalculatorTool } from "./tools/calculator.js";
import { registerHackernewsTools } from "./tools/hackernews.js";
import { registerWebSearchTool } from "./tools/web-search.js";
import { registerGeneralAgent } from "./agents/general.js";
import { registerGuardedAgent } from "./agents/guarded.js";
import { registerDocsAgent } from "./agents/docs.js";

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? env.DEFAULT_MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  resilience: { maxRetries: 2, baseDelayMs: 500 },
  compaction: { threshold: 20, preserveRecent: 4 },
  hooks: { level: "summary" },
  // Enable /crons API routes (actual scheduling handled by InternalScheduler below)
  cronScheduler: { async schedule() {}, async unschedule() {} },
  ...(voiceEnabled && {
    voice: { retainAudio: env.VOICE_RETAIN_AUDIO },
  }),
});

// Register voice providers when keys are available
if (voiceEnabled && plugin.voice) {
  if (env.OPENAI_API_KEY) {
    plugin.voice.register(
      new OpenAIVoiceProvider({
        apiKey: env.OPENAI_API_KEY,
        name: "openai",
        ttsModel: env.VOICE_TTS_MODEL,
        sttModel: env.VOICE_STT_MODEL,
        defaultSpeaker: env.VOICE_DEFAULT_SPEAKER,
      }),
    );
  }
  if (env.GROQ_API_KEY) {
    plugin.voice.register(
      new OpenAIVoiceProvider({
        apiKey: env.GROQ_API_KEY,
        name: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        sttModel: "whisper-large-v3-turbo",
        ttsModel: env.VOICE_TTS_MODEL,
        defaultSpeaker: env.VOICE_DEFAULT_SPEAKER,
      }),
    );
  }
}

// Register tools
registerEchoTool(plugin);
registerWeatherTool(plugin);
registerCalculatorTool(plugin);
registerHackernewsTools(plugin);
registerWebSearchTool(plugin);

// Register agents
registerGeneralAgent(plugin);
registerGuardedAgent(plugin);

// Register orchestrator
plugin.createOrchestrator({
  name: "orchestrator",
  description: "Routes queries to specialist agents",
  autonomous: true,
});

// Register a sample command
await plugin.storage.commands.save({
  name: "status",
  description: "Show server status including registered agents, tools, and uptime",
  system: "Report the current server status. Include the list of registered agents and tools, and the server uptime. Be concise.",
  tools: ["echo"],
});

// Subscribe to lifecycle hooks
plugin.on("agent:start", (e) => {
  console.log(`[hooks] Agent started: ${e.agentName} (conversation: ${e.conversationId})`);
});
plugin.on("agent:end", (e) => {
  console.log(`[hooks] Agent completed: ${e.agentName} in ${e.duration}ms (${e.usage.totalTokens} tokens)`);
});
plugin.on("agent:error", (e) => {
  console.error(`[hooks] Agent error: ${e.agentName}:`, e.error);
});
plugin.on("cron:executed", (e) => {
  console.log(`[hooks] Cron executed: ${e.cronId} (${e.status}) in ${e.duration}ms`);
});
plugin.on("job:end", (e) => {
  console.log(`[hooks] Job completed: ${e.jobId} (agent: ${e.agentName})`);
});

// Start the internal cron scheduler
const scheduler = createInternalScheduler(plugin, {
  onComplete: (job, exec) => console.log(`[cron] Completed: ${job.name} (${exec.id})`),
  onError: (job, err) => console.error(`[cron] Failed: ${job.name}:`, err.message),
});
scheduler.start();

// Seed a sample cron job if not already present
const existingJobs = await plugin.storage.crons.list();
if (!existingJobs.some((j: { name: string }) => j.name === "hourly-news-digest")) {
  await plugin.storage.crons.create({
    name: "hourly-news-digest",
    description: "Fetches and summarizes the top 5 Hacker News stories every hour",
    schedule: "0 * * * *",
    agentName: "general",
    input: "Give me a brief summary of the top 5 Hacker News stories right now.",
    enabled: true,
  });
  console.log("[cron] Seeded sample job: hourly-news-digest (runs every hour)");
}

// MCP Server config — stateless mode creates a fresh server + transport per request
const mcpConfig = { name: "kitn-api", version: "1.0.0", agents: ["general"] as string[] };
// MCP Client — optionally connect to external MCP servers
if (env.MCP_CONTEXT7) {
  try {
    const mcp = await connectMCPServers(plugin, {
      servers: [{
        name: "context7",
        transport: { type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      }],
    });
    console.log("[mcp] Connected to Context7 MCP — documentation tools available");
    registerDocsAgent(plugin);
    process.on("beforeExit", () => mcp.close());
  } catch (err) {
    console.warn("[mcp] Failed to connect to Context7 MCP:", (err as Error).message);
  }
}

// Build the app
const app = new Hono();
app.use("/*", cors());

// API key auth middleware — protects /api routes
app.use("/api/*", async (c, next) => {
  const key = c.req.header("X-API-Key");
  if (key !== env.API_KEY) {
    return c.json({ error: "Unauthorized — set X-API-Key header" }, 401);
  }
  await next();
});

app.route("/api", plugin.router);

// MCP endpoint — stateless mode requires a fresh server + transport per request
app.all("/mcp", async (c) => {
  const { server } = createMCPServer(plugin, mcpConfig);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  if (c.req.method === "POST") {
    const body = await c.req.json();
    return transport.handleRequest(c.req.raw, { parsedBody: body });
  }
  return transport.handleRequest(c.req.raw);
});

printConfig();
console.log(`[kitn-api] Running on http://localhost:${env.PORT}`);
console.log(`[kitn-api] API docs: http://localhost:${env.PORT}/api/reference`);
console.log(`[kitn-api] MCP server: http://localhost:${env.PORT}/mcp`);
console.log(`[kitn-api] Async jobs: POST /api/agents/:name?async=true → GET /api/jobs/:id`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
