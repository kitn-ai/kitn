import { tool } from "ai";
import { z } from "zod";

export const registrySearchTool = tool({
  description: "Search the kitn component registry for tools, agents, and other components",
  inputSchema: z.object({
    query: z.string().optional().describe("Search query"),
    type: z.enum(["tool", "agent", "all"]).default("all").describe("Component type to search for"),
    cwd: z.string().default(".").describe("Project directory"),
  }),
  execute: async ({ query, type, cwd }) => {
    const { listComponents } = await import("@kitnai/cli-core");
    const result = await listComponents({
      cwd,
      type: type === "all" ? undefined : type,
    });

    let items = result.items;
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      );
    }

    return {
      query,
      type,
      count: items.length,
      components: items.map((c) => ({
        name: c.name,
        type: c.type,
        description: c.description,
        installed: c.installed,
      })),
    };
  },
});

export const registryAddTool = tool({
  description: "Install a component from the kitn registry into the workspace",
  inputSchema: z.object({
    name: z.string().describe("Component name to install"),
    cwd: z.string().default(".").describe("Project directory"),
  }),
  execute: async ({ name, cwd }) => {
    const { addComponents } = await import("@kitnai/cli-core");
    const result = await addComponents({
      components: [name],
      cwd,
    });
    return {
      installed: result.installed.map((c) => c.name),
      created: result.created,
      errors: result.errors,
    };
  },
});
