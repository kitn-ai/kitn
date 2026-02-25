import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { createAIPlugin } from "@kitnai/hono";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { weatherTool } from "./tools/weather.js";
import { WEATHER_AGENT_CONFIG } from "./agents/weather-agent.js";

// --- Configuration ---

const PORT = Number(process.env.PORT ?? 4000);
const MODEL = process.env.DEFAULT_MODEL ?? "openai/gpt-4o-mini";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY — copy .env.example to .env and fill it in.");
  process.exit(1);
}

// --- Plugin setup ---

const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? MODEL),
});

// --- Register tools ---

plugin.tools.register({
  name: "getWeather",
  description: "Get current weather for a location",
  inputSchema: z.object({ location: z.string() }),
  tool: weatherTool,
  directExecute: async (input) =>
    weatherTool.execute!(input, { toolCallId: "direct" } as any),
  category: "weather",
});

// --- Register agents ---

const tools = WEATHER_AGENT_CONFIG.tools;
const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

plugin.agents.register({
  name: "weather",
  description: "Weather specialist agent",
  toolNames: Object.keys(tools),
  defaultFormat: "sse",
  defaultSystem: WEATHER_AGENT_CONFIG.system,
  tools,
  sseHandler,
  jsonHandler,
});

// --- Build and start the server ---

const app = new Hono();
app.use("/*", cors());
app.route("/api", plugin.app);

await plugin.initialize();

console.log(`kitn getting-started server running on http://localhost:${PORT}`);
console.log(`API docs: http://localhost:${PORT}/api/doc`);

serve({ fetch: app.fetch, port: PORT });
