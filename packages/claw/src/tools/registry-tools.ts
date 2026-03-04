import { tool } from "ai";
import { z } from "zod";
import { join } from "path";
import { homedir } from "os";

// Registry operations always target KitnClaw's own workspace, never the
// user's current directory. This prevents kitn.json/kitn.lock files from
// being scattered across the filesystem.
const CLAW_WORKSPACE = join(homedir(), ".kitnclaw", "workspace");

export const registrySearchTool = tool({
  description: "Search the kitn component registry for tools, agents, and other components",
  inputSchema: z.object({
    query: z.string().optional().describe("Search query"),
    type: z.enum(["tool", "agent", "all"]).default("all").describe("Component type to search for"),
  }),
  execute: async ({ query, type }) => {
    const { listComponents } = await import("@kitnai/cli-core");
    const result = await listComponents({
      cwd: CLAW_WORKSPACE,
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
  description: "Install a component from the kitn registry into the KitnClaw workspace",
  inputSchema: z.object({
    name: z.string().describe("Component name to install"),
  }),
  execute: async ({ name }) => {
    const { addComponents } = await import("@kitnai/cli-core");
    const result = await addComponents({
      components: [name],
      cwd: CLAW_WORKSPACE,
    });
    return {
      installed: result.installed.map((c) => c.name),
      created: result.created,
      errors: result.errors,
    };
  },
});
