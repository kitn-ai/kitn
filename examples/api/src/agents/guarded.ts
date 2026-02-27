import type { AIPluginInstance } from "@kitnai/hono-adapter";
import { echoTool } from "../tools/echo.js";

export function registerGuardedAgent(plugin: AIPluginInstance) {
  const tools = { echo: echoTool };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools });

  plugin.agents.register({
    name: "guarded",
    description: "Agent with a guard that blocks messages containing 'blocked'",
    toolNames: ["echo"],
    defaultFormat: "sse",
    defaultSystem: "You are a guarded assistant. Echo user messages back to them.",
    tools,
    sseHandler,
    jsonHandler,
    guard: async (query) => {
      if (query.toLowerCase().includes("blocked")) {
        return { allowed: false, reason: "Message contains blocked keyword" };
      }
      return { allowed: true };
    },
  });
}
