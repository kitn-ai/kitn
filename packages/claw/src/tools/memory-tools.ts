import { tool } from "ai";
import { z } from "zod";
import type { PluginContext } from "@kitnai/core";

export function createMemoryTools(ctx: PluginContext) {
  const memorySearch = tool({
    description: "Search stored memories by listing entries in a namespace",
    inputSchema: z.object({
      namespace: z.string().default("default").describe("Memory namespace"),
    }),
    execute: async ({ namespace }) => {
      const store = ctx.storage.memory;
      const entries = await store.listEntries(namespace);
      return {
        namespace,
        count: entries.length,
        entries: entries.map((e) => ({
          key: e.key,
          value: e.value,
          context: e.context,
        })),
      };
    },
  });

  const memorySave = tool({
    description: "Save a memory entry for later retrieval",
    inputSchema: z.object({
      key: z.string().describe("Unique key for this memory"),
      value: z.string().describe("The content to remember"),
      context: z.string().optional().describe("Additional context about this memory"),
      namespace: z.string().default("default").describe("Memory namespace"),
    }),
    execute: async ({ key, value, context, namespace }) => {
      const store = ctx.storage.memory;
      await store.saveEntry(namespace, key, value, context);
      return { saved: true, key, namespace };
    },
  });

  return { memorySearch, memorySave };
}
