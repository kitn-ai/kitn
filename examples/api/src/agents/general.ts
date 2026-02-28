import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { echoTool } from "../tools/echo.js";
import { weatherTool } from "../tools/weather.js";
import { calculatorTool } from "../tools/calculator.js";
import { hackernewsTopStoriesTool, hackernewsStoryDetailTool } from "../tools/hackernews.js";
import { searchWebTool } from "../tools/web-search.js";

export function registerGeneralAgent(plugin: AIPluginInstance) {
  const tools = {
    echo: echoTool,
    getWeather: weatherTool,
    calculate: calculatorTool,
    hackernewsTopStories: hackernewsTopStoriesTool,
    hackernewsStoryDetail: hackernewsStoryDetailTool,
    searchWeb: searchWebTool,
  };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

  plugin.agents.register({
    name: "general",
    description:
      "General-purpose agent with weather, calculator, web search, and Hacker News tools",
    toolNames: [
      "echo", "getWeather", "calculate",
      "hackernewsTopStories", "hackernewsStoryDetail", "searchWeb",
    ],
    defaultFormat: "sse",
    defaultSystem:
      "You are a helpful assistant. Use your tools to help the user. You can echo messages, check weather, do math calculations, search the web, and browse Hacker News.",
    tools,
    sseHandler,
    jsonHandler,
  });
}
