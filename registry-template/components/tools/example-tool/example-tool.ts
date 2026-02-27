import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const exampleTool = tool({
  description: "Echoes the input back to the user",
  inputSchema: z.object({
    message: z.string().describe("The message to echo"),
  }),
  execute: async ({ message }) => {
    return { echo: message };
  },
});

registerTool({
  name: "example-tool",
  description: "Echoes the input back to the user",
  inputSchema: z.object({ message: z.string() }),
  tool: exampleTool,
});
