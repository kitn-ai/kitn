import type { PluginContext } from "@kitnai/core";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { fileSearchTool } from "./file-search.js";
import { bashTool } from "./bash.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { createMemoryTools } from "./memory-tools.js";
import { registrySearchTool, registryAddTool } from "./registry-tools.js";
import { createToolTool, createAgentTool } from "./create-tools.js";

export function registerBuiltinTools(ctx: PluginContext): void {
  const { memorySearch, memorySave } = createMemoryTools(ctx);

  const tools: Array<{ name: string; description: string; tool: any; inputSchema: any; category?: string }> = [
    { name: "file-read", description: "Read file contents", tool: fileReadTool, inputSchema: fileReadTool.inputSchema, category: "filesystem" },
    { name: "file-write", description: "Write to a file", tool: fileWriteTool, inputSchema: fileWriteTool.inputSchema, category: "filesystem" },
    { name: "file-search", description: "Search for files", tool: fileSearchTool, inputSchema: fileSearchTool.inputSchema, category: "filesystem" },
    { name: "bash", description: "Execute shell commands", tool: bashTool, inputSchema: bashTool.inputSchema, category: "system" },
    { name: "web-fetch", description: "Fetch URL content", tool: webFetchTool, inputSchema: webFetchTool.inputSchema, category: "web" },
    { name: "web-search", description: "Search the web", tool: webSearchTool, inputSchema: webSearchTool.inputSchema, category: "web" },
    { name: "memory-search", description: "Search memories", tool: memorySearch, inputSchema: memorySearch.inputSchema, category: "memory" },
    { name: "memory-save", description: "Save a memory", tool: memorySave, inputSchema: memorySave.inputSchema, category: "memory" },
    { name: "kitn-registry-search", description: "Search kitn registry", tool: registrySearchTool, inputSchema: registrySearchTool.inputSchema, category: "registry" },
    { name: "kitn-add", description: "Install from registry", tool: registryAddTool, inputSchema: registryAddTool.inputSchema, category: "registry" },
    { name: "create-tool", description: "Create a new tool", tool: createToolTool, inputSchema: createToolTool.inputSchema, category: "creation" },
    { name: "create-agent", description: "Create a new agent", tool: createAgentTool, inputSchema: createAgentTool.inputSchema, category: "creation" },
  ];

  for (const t of tools) {
    ctx.tools.register({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      tool: t.tool,
      category: t.category,
    });
  }
}
