import { tool } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a memory-enabled agent. You can remember information across conversations by saving and recalling memories.

When the user tells you to remember something:
1. Use the saveMemory tool to store the information with a descriptive key
2. Confirm what you've saved

When the user asks about something they previously told you:
1. Use the recallMemory tool to look up specific information
2. Use the listMemories tool to see all stored memories if needed
3. Respond based on what you find

Be proactive about saving relevant preferences, facts, and context the user shares.`;

/**
 * In-memory store for demonstration purposes.
 * Replace with your own persistent storage backend.
 */
const memoryStore = new Map<string, { key: string; value: string; savedAt: string }>();

const saveMemoryTool = tool({
  description: "Save a piece of information to persistent memory",
  inputSchema: z.object({
    key: z
      .string()
      .describe("A descriptive key for this memory (e.g. 'user_name', 'preferred_language')"),
    value: z.string().describe("The information to remember"),
  }),
  execute: async ({ key, value }) => {
    const entry = { key, value, savedAt: new Date().toISOString() };
    memoryStore.set(key, entry);
    return { saved: true, key: entry.key, value: entry.value };
  },
});

const recallMemoryTool = tool({
  description: "Recall a specific piece of information from memory by key",
  inputSchema: z.object({
    key: z.string().describe("The key of the memory to recall"),
  }),
  execute: async ({ key }) => {
    const entry = memoryStore.get(key);
    if (!entry) return { found: false, key };
    return { found: true, key: entry.key, value: entry.value };
  },
});

const listMemoriesTool = tool({
  description: "List all stored memories",
  inputSchema: z.object({}),
  execute: async () => {
    const memories = [...memoryStore.values()];
    return {
      count: memories.length,
      memories: memories.map((m) => ({ key: m.key, value: m.value })),
    };
  },
});

export const MEMORY_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: {
    saveMemory: saveMemoryTool,
    recallMemory: recallMemoryTool,
    listMemories: listMemoriesTool,
  },
};
