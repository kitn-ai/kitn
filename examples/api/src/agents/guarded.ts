import type { AIPluginInstance } from "@kitnai/hono-openapi-adapter";
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
    // The guard receives an optional `context` parameter auto-populated by the
    // adapter.  When the client sends a `conversationId` in the request body,
    // `context.hasHistory` is true — useful for skipping the guard on follow-ups.
    guard: async (query, _agent, context) => {
      // Allow follow-up messages — the conversation is already established
      if (context?.hasHistory) return { allowed: true };

      if (query.toLowerCase().includes("blocked")) {
        return { allowed: false, reason: "Message contains blocked keyword" };
      }
      return { allowed: true };
    },
  });
}
