import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { echoTool } from "../tools/echo.js";
import { weatherTool } from "../tools/weather.js";
import { calculatorTool } from "../tools/calculator.js";

export function registerGeneralAgent(plugin: AIPluginInstance) {
  const tools = { echo: echoTool, getWeather: weatherTool, calculate: calculatorTool };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

  plugin.agents.register({
    name: "general",
    description: "General-purpose agent with echo, weather, and calculator tools",
    toolNames: ["echo", "getWeather", "calculate"],
    defaultFormat: "sse",
    defaultSystem:
      "You are a helpful assistant. Use your tools to help the user. You can echo messages, check weather, and do math calculations.",
    tools,
    sseHandler,
    jsonHandler,
  });
}
