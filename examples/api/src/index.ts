import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAIPlugin, createFileStorage, OpenAIVoiceProvider } from "@kitnai/hono";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { env, printConfig, voiceEnabled } from "./env.js";
import { registerEchoTool } from "./tools/echo.js";
import { registerWeatherTool } from "./tools/weather.js";
import { registerCalculatorTool } from "./tools/calculator.js";
import { registerGeneralAgent } from "./agents/general.js";
import { registerGuardedAgent } from "./agents/guarded.js";

const plugin = createAIPlugin({
  getModel: (id) => openrouter(id ?? env.DEFAULT_MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  resilience: { maxRetries: 2, baseDelayMs: 500 },
  compaction: { threshold: 20, preserveRecent: 4 },
  ...(voiceEnabled && {
    voice: { retainAudio: env.VOICE_RETAIN_AUDIO },
  }),
});

// Register voice provider when keys are available
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

// Register agents
registerGeneralAgent(plugin);
registerGuardedAgent(plugin);

// Register orchestrator
plugin.createOrchestrator({
  name: "orchestrator",
  description: "Routes queries to specialist agents",
  autonomous: true,
});

// Build the app
const app = new Hono();
app.use("/*", cors());
app.route("/api", plugin.app);

// Initialize and start
await plugin.initialize();

printConfig();
console.log(`[kitn-api] Running on http://localhost:${env.PORT}`);
console.log(`[kitn-api] API Reference: http://localhost:${env.PORT}/api/reference`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
