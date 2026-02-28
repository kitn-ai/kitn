import type { AIPluginInstance } from "@kitnai/hono-adapter";

/**
 * Register a documentation agent powered by Context7 MCP tools.
 * Call this AFTER connectMCPServers() so the tools are available.
 */
export function registerDocsAgent(plugin: AIPluginInstance) {
  const resolveReg = plugin.tools.get("context7_resolve-library-id");
  const queryReg = plugin.tools.get("context7_query-docs");

  if (!resolveReg || !queryReg) {
    console.warn("[docs] Context7 tools not found — skipping docs agent registration");
    return;
  }

  const tools = {
    "context7_resolve-library-id": resolveReg.tool,
    "context7_query-docs": queryReg.tool,
  };
  const { sseHandler, jsonHandler } = plugin.createHandlers({ tools, agentName: "docs" });

  plugin.agents.register({
    name: "docs",
    description: "Documentation lookup agent — searches library docs via Context7",
    toolNames: ["context7_resolve-library-id", "context7_query-docs"],
    defaultFormat: "sse",
    defaultSystem: [
      "You are a documentation assistant. Help users find library documentation, code examples, and API references.",
      "",
      "You have two tools:",
      "1. context7_resolve-library-id — Resolve a library name to a Context7 ID. Always call this first.",
      "2. context7_query-docs — Query documentation for a specific library using its Context7 ID.",
      "",
      "Workflow: resolve the library ID first, then query docs with a specific question.",
      "Present results clearly with code examples when available.",
    ].join("\n"),
    tools,
    sseHandler,
    jsonHandler,
  });
}
