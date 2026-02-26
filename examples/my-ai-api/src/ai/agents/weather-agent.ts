import { registerAgent } from "../utils/registry.ts";
import { weatherTool } from "../tools/weather.ts";

const SYSTEM_PROMPT = `You are a weather specialist agent. Your job is to provide accurate, helpful weather information.

When asked about weather:
1. Use the getWeather tool to fetch current conditions
2. Present the data in a clear, conversational format
3. Include temperature, conditions, humidity, and wind info
4. Offer practical advice based on conditions (e.g., "bring an umbrella")

Always use the tool to get real data rather than guessing.`;

// Self-register
registerAgent({
  name: "weather",
  description: "Weather specialist — fetches and presents weather data",
  system: SYSTEM_PROMPT,
  tools: { getWeather: weatherTool },
});
