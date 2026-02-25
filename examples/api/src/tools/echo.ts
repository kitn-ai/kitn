import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/server";

export const echoTool = tool({
  description: "Echoes back the input message",
  inputSchema: z.object({
    message: z.string().describe("The message to echo back"),
  }),
  execute: async ({ message }) => ({ echo: message }),
});

export function registerEchoTool(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "echo",
    description: "Echoes back the input message",
    inputSchema: z.object({ message: z.string() }),
    tool: echoTool,
    directExecute: async (input) => ({ echo: input.message }),
    category: "utility",
  });
}
